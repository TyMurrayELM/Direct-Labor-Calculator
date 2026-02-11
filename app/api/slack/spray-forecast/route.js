import { NextResponse } from 'next/server';

const SLACK_CHANNELS = {
  lv: 'C06JBNL7UKX',
  default: 'C06U9K3EKT7',
};

export async function POST(request) {
  try {
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
      sprayRevenue,
      laborRevenue,
      month,
      monthFtes,
      monthCrews,
    } = body;

    const fmt = (v) =>
      new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }).format(v);

    const channel = branchName.includes('Las Vegas')
      ? SLACK_CHANNELS.lv
      : SLACK_CHANNELS.default;

    const emojiPrefix = branchName.includes('Phoenix') ? ':az: '
      : branchName.includes('Las Vegas') ? ':fab_lv: '
      : '';
    const displayName = emojiPrefix + branchName;

    const blocks = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `Spray Forecast — ${branchName} ${year}`,
          emoji: true,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${displayName} ${year}`,
        },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*${month} Spray Revenue Target:*\n${fmt(sprayRevenue)}` },
          { type: 'mrkdwn', text: `*${month} Labor Revenue (90%):*\n${fmt(laborRevenue)}` },
          { type: 'mrkdwn', text: `*${month} FTEs Required:*\n${Number(monthFtes).toFixed(1)}` },
        ],
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `${Math.ceil(monthCrews)} crew(s) needed in ${month}  •  12% of (Maint + Onsite)`,
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
        channel,
        text: `Spray Forecast — ${branchName} ${year}: ${month} Revenue ${fmt(sprayRevenue)}, Labor ${fmt(laborRevenue)}, ${Number(monthFtes).toFixed(1)} FTEs`,
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

    return NextResponse.json({ success: true, message: 'Forecast sent to Slack' });
  } catch (error) {
    console.error('Slack spray-forecast error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Unknown error' },
      { status: 500 }
    );
  }
}
