export const metadata = {
  title: 'Maintenance FTE Forecast | Encore Services',
  description: 'Maintenance department revenue forecasting and FTE planning. Track revenue, labor costs, direct labor percentage, and headcount targets.',
  openGraph: {
    title: '🌿 Maintenance FTE Forecast',
    description: 'Annual Revenue • Labor Cost at Target • YTD Actual DL % • Average FTEs/Month',
    type: 'website',
    siteName: 'Encore Services',
  },
  twitter: {
    card: 'summary',
    title: '🌿 Maintenance FTE Forecast',
    description: 'Annual Revenue • Labor Cost at Target • YTD Actual DL % • Average FTEs/Month',
  },
  icons: {
    icon: '/favicon.ico',
  },
};

export default function ForecastLayout({ children }) {
  return children;
}