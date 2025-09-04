import type React from "react"
import type { Metadata } from "next"
import { Inter } from "next/font/google"
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
})

export const metadata: Metadata = {
  title: "NadFaucet",
  description: "Become a validator and earn $MON",
  icons: [
    {
      url: '/public/images/my-icon.png',
      sizes: '32x32',
      type: 'image/png',
    },
    {
      url: '/public/images/my-icon.ico',
      sizes: 'any',
      type: 'image/x-icon',
    },
  ],
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="font-sans antialiased">{children}</body>
    </html>
  )
}
