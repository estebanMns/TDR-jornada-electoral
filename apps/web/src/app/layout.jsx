import { Bricolage_Grotesque, Public_Sans, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';

const display = Bricolage_Grotesque({ subsets: ['latin'], variable: '--fuente-display', display: 'swap' });
const texto = Public_Sans({ subsets: ['latin'], variable: '--fuente-texto', display: 'swap' });
const datos = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--fuente-datos',
  display: 'swap',
});

export const metadata = {
  title: { default: 'Mesa a Mesa · Preconteo electoral', template: '%s · Mesa a Mesa' },
  description:
    'Preconteo departamental en tiempo real: cada mesa que informa aparece en segundos, con correcciones explicadas.',
};

export const viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f3f5f9' },
    { media: '(prefers-color-scheme: dark)', color: '#121029' },
  ],
};

export default function RootLayout({ children }) {
  return (
    <html lang="es" className={`${display.variable} ${texto.variable} ${datos.variable}`}>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
