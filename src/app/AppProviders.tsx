import React from 'react';
import { SessionProvider } from '../domains/session/sessionStore';
import { MarketProvider } from '../domains/market/marketStore';
import { PortfolioProvider } from '../domains/portfolio/portfolioStore';
import { ExecutionProvider } from '../domains/execution/executionStore';
import { NotificationProvider } from '../stores/notificationStore';

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <NotificationProvider>
      <SessionProvider>
        <MarketProvider>
          <PortfolioProvider>
            <ExecutionProvider>
              {children}
            </ExecutionProvider>
          </PortfolioProvider>
        </MarketProvider>
      </SessionProvider>
    </NotificationProvider>
  );
}
