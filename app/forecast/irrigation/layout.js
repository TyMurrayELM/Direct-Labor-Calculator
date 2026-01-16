export const metadata = {
  title: 'Irrigation FTE Forecast | Encore Services',
  description: 'Irrigation department FTE forecasting based on 25% of Maintenance + Onsite Revenue. Track labor revenue, billable hours, and crew requirements.',
  openGraph: {
    title: '💧 Irrigation FTE Forecast',
    description: 'Irrigation Revenue Target • Labor Revenue • Labor Cost • FTEs Required',
    type: 'website',
    siteName: 'Forecast Tool',
  },
  twitter: {
    card: 'summary',
    title: '💧 Irrigation FTE Forecast',
    description: 'Irrigation Revenue Target • Labor Revenue • Labor Cost • FTEs Required',
  },
  icons: {
    icon: '/favicon.ico',
  },
};

export default function IrrigationLayout({ children }) {
  return children;
}