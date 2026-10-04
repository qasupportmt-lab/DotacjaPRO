import './globals.css';

export const metadata = {
  title: 'DoradcaPRO',
  description: 'Cyfrowy doradca finansowania działalności gospodarczej'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="pl"><body>{children}</body></html>;
}
