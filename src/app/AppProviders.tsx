import React from 'react';
import { AutomationProvider } from '../domains/automation/automationStore';
import { SessionProvider } from '../domains/session/sessionStore';
import { MarketProvider } from '../domains/market/marketStore';
import { PortfolioProvider } from '../domains/portfolio/portfolioStore';
import { ExecutionProvider } from '../domains/execution/executionStore';
import { JournalProvider } from '../domains/journal/journalStore';
import { RiskProvider } from '../domains/risk/riskStore';
import { SellerIntelligenceProvider } from '../domains/seller/sellerIntelligenceStore';
import { NotificationProvider } from '../stores/notificationStore';

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <NotificationProvider>
      <SessionProvider>
        <MarketProvider>
          <PortfolioProvider>
            <ExecutionProvider>
              <RiskProvider>
                <SellerIntelligenceProvider>
                  <JournalProvider>
                    <AutomationProvider>
                      {children}
                    </AutomationProvider>
                  </JournalProvider>
                </SellerIntelligenceProvider>
              </RiskProvider>
            </ExecutionProvider>
          </PortfolioProvider>
        </MarketProvider>
      </SessionProvider>
    </NotificationProvider>
  );
}
