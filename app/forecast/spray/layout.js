export const metadata = {
  title: 'Spray FTE Forecast | Encore Services',
  description: 'Spray department FTE forecasting based on 15% of Maintenance + Onsite Revenue. Track labor revenue, billable hours, and crew requirements.',
  openGraph: {
    title: 'Spray FTE Forecast',
    description: 'Spray Revenue Target • Labor Revenue • Labor Cost • FTEs Required',
    type: 'website',
    siteName: 'Forecast Tool',
  },
  twitter: {
    card: 'summary',
    title: 'Spray FTE Forecast',
    description: 'Spray Revenue Target • Labor Revenue • Labor Cost • FTEs Required',
  },
  icons: {
    icon: '/favicon.ico',
  },
};

export default function SprayLayout({ children }) {
  return children;
}
