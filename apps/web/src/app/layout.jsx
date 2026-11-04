import './globals.css';

export const metadata = {
  title: 'Preconteo electoral',
  description: 'Transmisión y difusión de resultados en tiempo real',
};

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
