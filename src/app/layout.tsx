import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { ModeClassSync } from "@/components/mode-class-sync";
// Client-only Toaster wrapper — keeps Sonner's internal Set off the RSC
// protocol boundary (avoids the "Set objects are not supported" warning).
import { ClientToaster } from "@/components/client-toaster";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased bg-background text-foreground">
        <ThemeProvider>
          <ModeClassSync />
          {children}
          <ClientToaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
