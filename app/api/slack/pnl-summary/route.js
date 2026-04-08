import { NextResponse } from 'next/server';
import { getUserRole, isAdminRole } from '../../../lib/getUserRole';

// Test channel fallback.
const DEFAULT_CHANNEL = 'C046RPZGEHE';

// Per-department, per-branch channel routing.
const CHANNEL_ROUTES = {
  arbor: {
    phoenix: 'C06JT9Q4A3B',
    las_vegas: 'C027MTDGN3G',
  },
  enhancements: {
    phoenix: 'C06JTB3QS0Z',
    las_vegas: 'C01UPNF7M6J',
  },
  spray: {
    phoenix: 'C06U9K3EKT7',
    las_vegas: 'C01UWN4L403',
  },
  irrigation: {
    phoenix: 'C07DKUMMJTF',
    las_vegas: 'C06JBNL7UKX',
  },
};

function normalizeBranchName(branchName) {
  if (Array.isArray(branchName)) return branchName.join(' ');
  return String(branchName || '');
}

function resolveChannel(department, branchName) {
  const deptRoutes = CHANNEL_ROUTES[department];
  if (!deptRoutes) return null;
  const bn = normalizeBranchName(branchName).toLowerCase();
  if (bn.includes('las vegas')) return deptRoutes.las_vegas || null;
  if (bn.includes('phoenix')) return deptRoutes.phoenix || null;
  return null;
}

export async function POST(request) {
  try {
    const role = await getUserRole();
    if (!isAdminRole(role)) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const slackToken = process.env.SLACK_API_TOKEN;
    if (!slackToken) {
      return NextResponse.json(
        { success: false, error: 'SLACK_API_TOKEN not configured' },
        { status: 500 }
      );
    }

    const body = await request.json();
    const {
      branchName,
      year,
      department,
      monthLabel,
      forecastLabel,
      items = [],
      channel,
    } = body;

    if (!monthLabel) {
      return NextResponse.json(
        { success: false, error: 'No completed actual month available' },
        { status: 400 }
      );
    }
    if (!items.length) {
      return NextResponse.json(
        { success: false, error: 'No Key Items to send' },
        { status: 400 }
      );
    }

    const targetChannel = channel || resolveChannel(department, branchName) || DEFAULT_CHANNEL;

    const branchNameStr = normalizeBranchName(branchName);
    const emojiPrefix = branchNameStr.includes('Phoenix') ? ':az: '
      : branchNameStr.includes('Las Vegas') ? ':fab_lv: '
      : '';
    const displayName = `${emojiPrefix}${branchNameStr}`.trim();

    const deptLabel = (department || '')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());

    // Build a single mrkdwn block listing each Key Item with its month value + variance
    const lines = items.map((it) => {
      const left = `*${it.name}*: ${it.value}`;
      if (it.refValue && it.dollarVar) {
        const arrow = it.varDirection === 'up' ? ':white_check_mark:'
          : it.varDirection === 'down' ? ':x:' : '';
        return `${left}   _(Goal: ${it.refValue} • ${it.dollarVar}${it.pctVar ? ` / ${it.pctVar}` : ''} ${arrow})_`;
      }
      return left;
    });

    const blocks = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `${deptLabel || 'P&L'} Summary — ${monthLabel} ${year}`,
          emoji: true,
        },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: displayName,
          },
        ],
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: lines.join('\n'),
        },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: '<https://direct-labor-calculator.vercel.app/|Forecast can be reviewed in Forecast Tool>',
          },
        ],
      },
    ];

    const slackResponse = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${slackToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        channel: targetChannel,
        text: `${deptLabel || 'P&L'} Summary — ${monthLabel} ${year} (${displayName})`,
        blocks,
      }),
    });

    const slackData = await slackResponse.json();

    if (!slackData.ok) {
      return NextResponse.json(
        { success: false, error: `Slack API error: ${slackData.error}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Slack pnl-summary error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Unknown error' },
      { status: 500 }
    );
  }
}
