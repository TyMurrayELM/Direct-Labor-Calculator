export const metadata = {
  title: 'Arbor FTE Forecast | Encore Services',
  description: 'Arbor department FTE forecasting based on 50% of Maintenance + Onsite Revenue. Track billable hours, labor costs, and crew requirements.',
  openGraph: {
    title: '🌳 Arbor FTE Forecast',
    description: 'Arbor Revenue Target • Billable Hours • Labor Cost • FTEs Required',
    type: 'website',
    siteName: 'Forecast Tool',
  },
  twitter: {
    card: 'summary',
    title: '🌳 Arbor FTE Forecast',
    description: 'Arbor Revenue Target • Billable Hours • Labor Cost • FTEs Required',
  },
  icons: {
    icon: '/favicon.ico',
  },
};

export default function ArborLayout({ children }) {
  return children;
}