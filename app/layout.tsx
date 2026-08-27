import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  metadataBase: new URL('https://www.ententecomunicacion.com'),
  title: 'Entente | Diagnostico de intervencion ejecutiva',
  description:
    'Plataforma de oratoria ejecutiva para evaluar claridad, persuasion, estructura y presencia en intervenciones reales.',
  openGraph: {
    title: 'Entente | Diagnostico de intervencion ejecutiva',
    description:
      'Diagnostico ejecutivo de intervenciones reales con foco en claridad, persuasion y presencia.',
    siteName: 'Entente',
    locale: 'es_ES',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Entente | Diagnostico de intervencion ejecutiva',
    description:
      'Evalua intervenciones reales y genera un informe ejecutivo ordenado por criterio, no por ruido.',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
