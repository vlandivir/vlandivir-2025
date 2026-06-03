import React from 'react';
import ReactDOM from 'react-dom/client';
import { ChakraProvider, ColorModeScript, extendTheme } from '@chakra-ui/react';
import App from './App';

const theme = extendTheme({
  config: {
    initialColorMode: 'light',
    useSystemColorMode: false,
  },
  colors: {
    shadcn: {
      background: 'hsl(0 0% 100%)',
      foreground: 'hsl(222.2 84% 4.9%)',
      card: 'hsl(0 0% 100%)',
      muted: 'hsl(210 40% 96.1%)',
      mutedForeground: 'hsl(215.4 16.3% 46.9%)',
      border: 'hsl(214.3 31.8% 91.4%)',
      primary: 'hsl(222.2 47.4% 11.2%)',
      primaryForeground: 'hsl(210 40% 98%)',
      destructive: 'hsl(0 84.2% 60.2%)',
    },
  },
  fonts: {
    heading:
      'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
    body: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
  },
  radii: {
    md: '0.5rem',
    lg: '0.5rem',
    xl: '0.5rem',
  },
  shadows: {
    sm: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
  },
  styles: {
    global: {
      body: {
        bg: 'shadcn.background',
        color: 'shadcn.foreground',
        letterSpacing: '0',
      },
      '#root': {
        minH: '100vh',
      },
    },
  },
});

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ChakraProvider theme={theme}>
      <ColorModeScript initialColorMode={theme.config.initialColorMode} />
      <App />
    </ChakraProvider>
  </React.StrictMode>,
);
