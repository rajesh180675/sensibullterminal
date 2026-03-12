// Keep the copyable Kaggle backend snippet sourced from the shipped Python file
// so the modal cannot drift from the actual backend implementation.

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  X, Shield, Eye, EyeOff, ExternalLink, AlertTriangle,
  CheckCircle, Copy, Wifi, WifiOff, Bug, RefreshCw, Zap,
} from 'lucide-react';
import kaggleBackendSource from '../../kaggle_backend.py?raw';
import { BreezeSession }   from '../types/index';
import { CORS_PROXIES }    from '../config/market';
import {
  validateSession,
  extractApiSession,
  type DebugInfo,
} from '../utils/breezeClient';
import {
  connectToBreeze,
  checkBackendHealth,
  isKaggleBackend,
  setTerminalAuthToken,
} from '../utils/kaggleClient';
import { setWsAuthToken } from '../utils/breezeWs';

interface Props {
  onClose:     () => void;
  onConnected: (s: BreezeSession) => void;
  session:     BreezeSession | null;
}

type Tab    = 'connect' | 'kaggle' | 'debug';
type Status = 'idle' | 'loading' | 'ok' | 'error';

// ── CodeBlock with copy button ────────────────────────────────────────────────
const CodeBlock: React.FC<{ code: string; lang?: string }> = ({ code, lang }) => {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative group">
      {lang && (
        <span className="absolute top-2 left-3 text-[9px] text-gray-600 uppercase tracking-widest font-mono select-none">
          {lang}
        </span>
      )}
      <button
        onClick={() => {
          navigator.clipboard.writeText(code).catch(() => {});
          setCopied(true);
          setTimeout(() => setCopied(false), 2500);
        }}
        className="absolute top-2 right-2 p-1.5 bg-gray-800/80 hover:bg-gray-700 rounded-lg
                   opacity-0 group-hover:opacity-100 transition-opacity z-10"
      >
        {copied
          ? <CheckCircle size={10} className="text-emerald-400" />
          : <Copy size={10} className="text-gray-500" />}
      </button>
      <pre className="bg-[#080b12] border border-gray-800/50 rounded-xl p-4 pt-8 text-[10px] text-gray-300
                      overflow-x-auto font-mono leading-relaxed whitespace-pre select-all">
        {code}
      </pre>
    </div>
  );
};

// ── Debug inspector panel ─────────────────────────────────────────────────────
const DebugInspector: React.FC<{ info: DebugInfo }> = ({ info }) => {
  const [show, setShow] = useState(true);
  return (
    <div className="bg-[#0a0c15] border border-purple-800/30 rounded-xl overflow-hidden text-[10px]">
      <button
        onClick={() => setShow(v => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-purple-400 font-semibold
                   hover:bg-purple-500/5 transition-colors"
      >
        <Bug size={10} /> Request Debug Inspector
        <span className="ml-auto text-gray-700">{show ? '▼' : '▶'}</span>
      </button>
      {show && (
        <div className="px-3 pb-3 space-y-2 font-mono">
          <Row label="Method"    val={info.method}    cls="text-emerald-400" />
          <Row label="URL"       val={info.url}       cls="text-blue-300 break-all" />
          <Row label="Timestamp" val={info.timestamp} cls="text-amber-400" />
          <div>
            <span className="text-gray-600">pyDumps body (checksum input):</span>
            <div className="mt-0.5 p-2 bg-[#0e1018] rounded-lg text-yellow-300 break-all">{info.bodyStr}</div>
          </div>
          <div>
            <span className="text-gray-600">SHA-256 checksum:</span>
            <div className="mt-0.5 p-2 bg-[#0e1018] rounded-lg text-emerald-300 break-all">{info.checksum}</div>
          </div>
          {info.httpStatus !== undefined && (
            <Row
              label="HTTP status"
              val={String(info.httpStatus)}
              cls={info.httpStatus === 200 ? 'text-emerald-400' : 'text-red-400'}
            />
          )}
          {info.responseBody && (
            <div>
              <span className="text-gray-600">Response body:</span>
              <div className="mt-0.5 p-2 bg-[#0e1018] rounded-lg text-gray-400 break-all max-h-28 overflow-y-auto">
                {info.responseBody}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const Row: React.FC<{ label: string; val: string; cls?: string }> = ({ label, val, cls = 'text-white' }) => (
  <div><span className="text-gray-600">{label}: </span><span className={cls}>{val}</span></div>
);

const KAGGLE_CODE_SNIPPET = kaggleBackendSource.trim();


// ── Main modal component ──────────────────────────────────────────────────────
export const ConnectBrokerModal: React.FC<Props> = ({ onClose, onConnected, session }) => {
  const [tab,          setTab]          = useState<Tab>('connect');
  const [apiKey,       setApiKey]       = useState(session?.apiKey       ?? '');
  const [apiSecret,    setApiSecret]    = useState(session?.apiSecret    ?? '');
  const [sessionToken, setSessionToken] = useState(session?.sessionToken ?? '');
  const [proxyBase,    setProxyBase]    = useState(session?.proxyBase    ?? CORS_PROXIES.vercelKaggle);
  // FIX (Bug #2): Auth token field — only needed if TERMINAL_AUTH_TOKEN is set in Kaggle
  const [authToken,    setAuthToken]    = useState(session?.backendAuthToken ?? '');
  const [showSecret,   setShowSecret]   = useState(false);
  const [status,       setStatus]       = useState<Status>('idle');
  const [statusMsg,    setStatusMsg]    = useState('');
  const [lastDebug,    setLastDebug]    = useState<DebugInfo | undefined>();
  const [healthMsg,    setHealthMsg]    = useState('');
  const [healthOk,     setHealthOk]     = useState<boolean | null>(null);
  const closeTimeoutRef = useRef<number | null>(null);

  // Auto-extract ?apisession= from URL on mount
  useEffect(() => {
    const token = extractApiSession();
    if (token) {
      setSessionToken(token);
      setStatus('ok');
      setStatusMsg('✓ Session token auto-extracted from URL redirect');
    }
  }, []);

  const loginUrl  = `https://api.icicidirect.com/apiuser/login?api_key=${encodeURIComponent(apiKey || 'YOUR_API_KEY')}`;
  useEffect(() => () => {
    if (closeTimeoutRef.current !== null) {
      window.clearTimeout(closeTimeoutRef.current);
    }
  }, []);

  const scheduleClose = useCallback(() => {
    if (closeTimeoutRef.current !== null) {
      window.clearTimeout(closeTimeoutRef.current);
    }
    closeTimeoutRef.current = window.setTimeout(() => onClose(), 1500);
  }, [onClose]);

  const allFilled = !!(apiKey.trim() && apiSecret.trim() && sessionToken.trim());
  const isBackend = isKaggleBackend(proxyBase.trim());

  // ── Health check ────────────────────────────────────────────────────────────
  const handleHealthCheck = useCallback(async () => {
    if (!proxyBase.trim()) { setHealthMsg('Enter a URL first'); setHealthOk(false); return; }
    setHealthMsg('⏳ Pinging backend...');
    setHealthOk(null);
    // FIX (Bug #2): Set auth token before health check so fetchJson includes it
    setTerminalAuthToken(authToken.trim() || undefined);
    setWsAuthToken(authToken.trim() || undefined);
    const result = await checkBackendHealth(proxyBase.trim());
    setHealthOk(result.ok);
    setHealthMsg(result.ok ? `✓ ${result.message}` : `✗ ${result.message}`);
  }, [proxyBase, authToken]);

  // ── Validate Live ───────────────────────────────────────────────────────────
  const handleValidateLive = useCallback(async () => {
    if (!allFilled) {
      setStatus('error');
      setStatusMsg('Fill in API Key, API Secret, and Session Token first.');
      return;
    }
    setStatus('loading');
    setStatusMsg('Connecting...');
    setLastDebug(undefined);

    const baseSession: BreezeSession = {
      apiKey:           apiKey.trim(),
      apiSecret:        apiSecret.trim(),
      sessionToken:     sessionToken.trim(),
      proxyBase:        proxyBase.trim(),
      backendAuthToken: authToken.trim() || undefined,
      isConnected:      false,
    };

    // FIX (Bug #2): Apply auth token globally BEFORE any API calls
    setTerminalAuthToken(authToken.trim() || undefined);
    setWsAuthToken(authToken.trim() || undefined);

    // ── Mode A: Python backend (Kaggle) ──────────────────────────────────────
    if (isBackend) {
      setStatusMsg('Connecting to Python backend (official Breeze SDK)...');
      try {
        const result = await connectToBreeze({
          apiKey:       apiKey.trim(),
          apiSecret:    apiSecret.trim(),
          sessionToken: sessionToken.trim(),
          backendUrl:   proxyBase.trim(),
        });
        if (result.ok) {
          const live: BreezeSession = {
            ...baseSession,
            sessionToken: result.sessionToken ?? baseSession.sessionToken,
            isConnected:  true,
            connectedAt:  new Date(),
          };
          setStatus('ok');
          setStatusMsg(`✓ Connected via Python SDK! ${result.user ? `(${result.user})` : ''}`);
          onConnected(live);
          scheduleClose();
        } else {
          setStatus('error');
          setStatusMsg(result.reason);
        }
      } catch (e) {
        setStatus('error');
        setStatusMsg(e instanceof Error ? e.message : String(e));
      }
      return;
    }

    // ── Mode B: Browser CORS proxy ───────────────────────────────────────────
    setStatusMsg('Calling /customerdetails via CORS proxy (SHA-256 browser)...');
    try {
      const result = await validateSession(baseSession);
      setLastDebug(result.debug);
      if (result.ok) {
        const live: BreezeSession = {
          ...baseSession,
          sessionToken: result.sessionToken ?? baseSession.sessionToken,
          isConnected:  true,
          connectedAt:  new Date(),
        };
        setStatus('ok');
        setStatusMsg(`✓ Live — ${result.reason}`);
        onConnected(live);
        scheduleClose();
      } else {
        setStatus('error');
        setStatusMsg(result.reason);
      }
    } catch (e) {
      setStatus('error');
      setStatusMsg(e instanceof Error ? e.message : String(e));
    }
  }, [apiKey, apiSecret, sessionToken, proxyBase, authToken, allFilled, isBackend, onConnected, scheduleClose]);

  // ── Save offline (no validation) ────────────────────────────────────────────
  const handleSaveOffline = useCallback(() => {
    if (!allFilled) { setStatus('error'); setStatusMsg('Fill in all fields first.'); return; }
    setTerminalAuthToken(authToken.trim() || undefined);
    setWsAuthToken(authToken.trim() || undefined);
    onConnected({
      apiKey:           apiKey.trim(),
      apiSecret:        apiSecret.trim(),
      sessionToken:     sessionToken.trim(),
      proxyBase:        proxyBase.trim(),
      backendAuthToken: authToken.trim() || undefined,
      isConnected:      false,
      connectedAt:      new Date(),
    });
    onClose();
  }, [apiKey, apiSecret, sessionToken, proxyBase, authToken, allFilled, onConnected, onClose]);

  const TABS: { id: Tab; label: string }[] = [
    { id: 'connect', label: '🔐 Connect' },
    { id: 'kaggle',  label: '🚀 Kaggle Backend' },
    { id: 'debug',   label: '🐛 Debug' },
  ];

  return (
    <div className="fixed inset-0 bg-black/85 backdrop-blur-sm z-50 flex items-center justify-center p-3">
      <div className="bg-[#13161f] border border-gray-700/50 rounded-2xl shadow-2xl
                      w-full max-w-[700px] max-h-[92vh] flex flex-col overflow-hidden">

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-800/60 flex-shrink-0">
          <div className="w-9 h-9 bg-gradient-to-br from-blue-500 to-indigo-700 rounded-xl
                          flex items-center justify-center flex-shrink-0">
            <Shield size={16} className="text-white" />
          </div>
          <div className="min-w-0">
            <h2 className="text-white font-bold text-sm">Connect Broker — ICICI Direct Breeze</h2>
            <p className="text-gray-600 text-[10px]">
              {isBackend ? '🚀 Python Backend Mode (recommended)' : '🌐 Browser-Direct Mode'} · SHA-256 via SubtleCrypto
            </p>
          </div>
          <div className={`ml-auto flex-shrink-0 flex items-center gap-1.5 text-[10px] font-semibold
                           px-2.5 py-1 rounded-full border ${
                             session?.isConnected
                               ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
                               : 'text-gray-500 bg-gray-800/40 border-gray-700/30'
                           }`}>
            {session?.isConnected ? <Wifi size={9} /> : <WifiOff size={9} />}
            {session?.isConnected ? 'Live' : 'Demo'}
          </div>
          <button onClick={onClose}
            className="ml-2 p-1.5 text-gray-600 hover:text-white hover:bg-gray-700/50 rounded-lg">
            <X size={15} />
          </button>
        </div>

        {/* ── Tabs ────────────────────────────────────────────────────────── */}
        <div className="flex px-5 border-b border-gray-800/40 flex-shrink-0">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`px-3 py-2.5 text-[11px] font-medium border-b-2 -mb-px transition-colors ${
                tab === t.id
                  ? 'text-white border-blue-500'
                  : 'text-gray-600 border-transparent hover:text-gray-300'
              }`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* ── Body ────────────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4 min-h-0">

          {/* ══════════════════════════════════════════════════════════════
              TAB: CONNECT
              ══════════════════════════════════════════════════════════════ */}
          {tab === 'connect' && (
            <>
              {/* Mode badge */}
              {isBackend ? (
                <div className="flex gap-2 p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl">
                  <Zap size={13} className="text-emerald-400 flex-shrink-0 mt-0.5" />
                  <div className="text-[11px] text-emerald-300">
                    <strong className="text-emerald-200">Python Backend Mode detected.</strong>
                    {' '}Uses official breeze-connect SDK — no CORS issues, no checksum math!
                    Orders, square-off, and all endpoints are properly implemented.
                  </div>
                </div>
              ) : (
                <div className="flex gap-2 p-3 bg-amber-500/8 border border-amber-500/20 rounded-xl">
                  <AlertTriangle size={13} className="text-amber-400 flex-shrink-0 mt-0.5" />
                  <div className="text-[11px] text-amber-300">
                    <strong className="text-amber-200">Browser-Direct Mode.</strong>
                    {' '}Often fails with "Request Object is Null". Strongly recommended:{' '}
                    <button onClick={() => setTab('kaggle')} className="underline text-white font-bold">
                      🚀 Use Kaggle Backend instead
                    </button>
                    {' '}— it actually works.
                  </div>
                </div>
              )}

              <div className="space-y-3">
                <Field label="API Key" hint="Permanent — from ICICI developer portal">
                  <input value={apiKey} onChange={e => setApiKey(e.target.value)}
                    placeholder="e.g. A1B2C3~D4E5F6..." className={INPUT} />
                </Field>

                <Field label="API Secret" hint="For SHA-256 only · never sent to any server">
                  <div className="relative">
                    <input type={showSecret ? 'text' : 'password'}
                      value={apiSecret} onChange={e => setApiSecret(e.target.value)}
                      placeholder="Your ICICI API Secret" className={INPUT + ' pr-10'} />
                    <button onClick={() => setShowSecret(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-400">
                      {showSecret ? <EyeOff size={13} /> : <Eye size={13} />}
                    </button>
                  </div>
                </Field>

                <Field label="Session Token" hint="Daily · from ?apisession= · expires midnight IST">
                  <input value={sessionToken} onChange={e => setSessionToken(e.target.value)}
                    placeholder="Paste your ?apisession= value here" className={INPUT} />
                  {apiKey.trim() && (
                    <a href={loginUrl} target="_blank" rel="noopener noreferrer"
                      className="mt-1.5 inline-flex items-center gap-1 text-[10px] text-blue-400 hover:text-blue-300 underline">
                      Open ICICI login → copy ?apisession= from redirect URL
                      <ExternalLink size={9} />
                    </a>
                  )}
                </Field>

                <Field label="Backend / CORS Proxy URL" hint="Use /api/kaggle on Vercel (recommended) or a direct Kaggle URL">
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {Object.entries(CORS_PROXIES).map(([k, v]) => (
                      <PresetBtn key={k} label={k} active={proxyBase === v} onClick={() => setProxyBase(v)} />
                    ))}
                    <PresetBtn
                      label="kaggle"
                      active={isKaggleBackend(proxyBase)}
                      onClick={() => setProxyBase('https://YOUR-URL.trycloudflare.com')}
                      highlight
                    />
                  </div>

                  <div className="flex gap-2">
                    <input value={proxyBase} onChange={e => setProxyBase(e.target.value)}
                      placeholder="/api/kaggle  or  https://xyz.trycloudflare.com"
                      className={INPUT + ' flex-1'} />
                    <button onClick={handleHealthCheck}
                      className="px-2 py-1 bg-[#1e2135] border border-gray-700/30 rounded-xl
                                 text-gray-600 hover:text-gray-300 text-[10px] flex-shrink-0
                                 flex items-center gap-1">
                      <RefreshCw size={9} /> ping
                    </button>
                  </div>

                  {healthMsg && (
                    <p className={`text-[10px] mt-1 ${healthOk ? 'text-emerald-400' : 'text-red-400'}`}>
                      {healthMsg}
                    </p>
                  )}

                  {!isBackend && proxyBase.includes('cors-anywhere') && (
                    <div className="mt-2 text-[10px] text-amber-400 bg-amber-500/8 border border-amber-500/20 rounded-lg p-2">
                      ⚠️ Must unlock cors-anywhere first:{' '}
                      <a href="https://cors-anywhere.herokuapp.com/corsdemo"
                        target="_blank" rel="noopener noreferrer"
                        className="underline text-amber-300">
                        cors-anywhere.herokuapp.com/corsdemo
                      </a>{' '}
                      → "Request temporary access"
                    </div>
                  )}

                  {proxyBase.trim() === '/api/kaggle' && (
                    <div className="mt-2 text-[10px] text-blue-300 bg-blue-500/8 border border-blue-500/20 rounded-lg p-2">
                      Vercel proxy mode: set <strong className="text-white">KAGGLE_BACKEND_URL</strong> in Vercel
                      environment variables to your running Kaggle/tunnel base URL.
                    </div>
                  )}
                </Field>
              </div>

              {/* Status */}
              {/* Auth token — only shown for Kaggle backend mode */}
              {isBackend && (
                <Field label="Backend Auth Token" hint="Optional — only if Kaggle cell sets TERMINAL_AUTH_TOKEN">
                  <input
                    value={authToken}
                    onChange={e => setAuthToken(e.target.value)}
                    placeholder="Leave blank unless Kaggle output shows an auth token"
                    className={INPUT}
                  />
                  <p className="text-[10px] text-gray-700 mt-1">
                    By default auth is <strong className="text-gray-500">disabled</strong> in v7 backend — leave blank.{' '}
                    Only fill this if you explicitly set <code className="text-gray-500">TERMINAL_AUTH_TOKEN</code> in Kaggle.
                  </p>
                </Field>
              )}

              {status !== 'idle' && (
                <div className={`flex items-start gap-2 p-3 rounded-xl text-[11px] border ${
                  status === 'ok'    ? 'bg-emerald-500/6 border-emerald-500/20 text-emerald-300' :
                  status === 'error' ? 'bg-red-500/6 border-red-500/20 text-red-300' :
                                       'bg-blue-500/6 border-blue-500/20 text-blue-300'
                }`}>
                  {status === 'loading' && (
                    <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin flex-shrink-0 mt-0.5" />
                  )}
                  {status === 'ok'    && <CheckCircle   size={13} className="flex-shrink-0 mt-0.5" />}
                  {status === 'error' && <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />}
                  <div className="whitespace-pre-wrap min-w-0 break-words">
                    <p className="font-semibold">{statusMsg}</p>
                    {status === 'error' && isBackend && (
                      <div className="mt-2 space-y-1 text-[10px] text-gray-400 border-t border-gray-700/40 pt-2">
                        <p className="text-amber-300 font-semibold">Backend troubleshooting:</p>
                        {(statusMsg.includes('HTML') || statusMsg.toLowerCase().includes('cloudflare') || statusMsg.toLowerCase().includes('trycloudflare') || statusMsg.includes('interstitial')) ? (
                          <>
                            <p className="text-red-300 font-semibold">Cloudflare Interstitial Detected</p>
                            <p>① Copy your tunnel URL from Kaggle output (e.g. <span className="text-amber-300">https://abc.trycloudflare.com</span>)</p>
                            <p>② Open <strong className="text-white">that URL + /health</strong> in a new browser tab</p>
                            <p>③ Wait until you see <span className="text-emerald-400">{'{"status":"online"}'}</span></p>
                            <p>④ Come back → retry <strong className="text-white">ping</strong> → <strong className="text-white">Validate Live</strong></p>
                            <p className="text-gray-500 mt-1">The Vercel proxy now auto-bypasses this for subsequent requests.</p>
                          </>
                        ) : (
                          <>
                            <p>① Check Kaggle cell is still running (may have timed out)</p>
                            <p>② Copy the LATEST URL from Kaggle output</p>
                            <p>③ Click <strong className="text-white">ping</strong> to test basic connectivity first</p>
                            <p>④ For Cloudflare URLs: open URL in a browser tab first</p>
                          </>
                        )}
                      </div>
                    )}
                    {status === 'error' && !isBackend && (
                      <div className="mt-2 text-[10px] text-gray-500 border-t border-gray-700/40 pt-2">
                        <p className="text-amber-300">
                          💡 Browser-direct mode often fails. Switch to{' '}
                          <button onClick={() => setTab('kaggle')} className="underline text-white">
                            🚀 Kaggle Backend
                          </button>{' '}
                          for reliable connections.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {lastDebug && <DebugInspector info={lastDebug} />}

              <div className="grid grid-cols-2 gap-2">
                <button onClick={handleValidateLive}
                  disabled={!allFilled || status === 'loading'}
                  className="flex items-center justify-center gap-1.5 py-2.5 bg-indigo-600
                             hover:bg-indigo-500 disabled:opacity-35 disabled:cursor-not-allowed
                             text-white rounded-xl text-[11px] font-bold transition-colors">
                  {status === 'loading'
                    ? <><div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" /> Connecting...</>
                    : <><Wifi size={10} /> Validate Live</>}
                </button>
                <button onClick={handleSaveOffline}
                  disabled={!allFilled}
                  className="flex items-center justify-center gap-1.5 py-2.5 bg-[#1e2135]
                             hover:bg-[#252840] disabled:opacity-35 disabled:cursor-not-allowed
                             text-gray-300 rounded-xl text-[11px] font-medium border
                             border-gray-700/30 transition-colors">
                  <Shield size={10} /> Save (Demo mode)
                </button>
              </div>
            </>
          )}

          {/* ══════════════════════════════════════════════════════════════
              TAB: KAGGLE BACKEND
              ══════════════════════════════════════════════════════════════ */}
          {tab === 'kaggle' && (
            <div className="space-y-4">
              <div className="flex gap-2 p-3 bg-emerald-500/8 border border-emerald-500/20 rounded-xl">
                <CheckCircle size={14} className="text-emerald-400 flex-shrink-0 mt-0.5" />
                <div className="text-[11px] text-emerald-300 space-y-1">
                  <p className="font-bold text-emerald-200 text-xs">Why Kaggle Backend?</p>
                  <p>
                    The browser cannot reliably call ICICI's API directly (CORS, checksum format issues).
                    Kaggle gives a free Python server that uses the official{' '}
                    <code className="bg-black/40 px-1 rounded">breeze-connect</code> SDK,
                    which handles all authentication properly. Orders and square-off actually work.
                  </p>
                  <p className="text-amber-300 font-semibold">
                    All endpoints included: connect, option chain, place order, square off, cancel, order book, trade book, positions, funds.
                  </p>
                </div>
              </div>

              <StepBox n="1" title="Create a Kaggle Notebook">
                <ol className="list-decimal list-inside space-y-1 text-[11px] text-gray-400">
                  <li>Go to <a href="https://www.kaggle.com/code" target="_blank" rel="noopener noreferrer"
                       className="text-blue-400 underline">kaggle.com/code</a> → <strong className="text-white">New Notebook</strong></li>
                  <li>Settings (gear icon) → <strong className="text-amber-300">Internet: ON</strong> ← mandatory</li>
                  <li>Type: Code (not Markdown)</li>
                </ol>
              </StepBox>

              <StepBox n="2" title="Copy this entire code into ONE cell and click Run">
                <div className="mb-2 text-[10px] text-amber-400 bg-amber-500/8 border border-amber-500/20 rounded-lg p-2">
                  ⚠️ Copy the ENTIRE block below. Do not split into multiple cells.
                </div>
                <CodeBlock lang="kaggle_backend.py" code={KAGGLE_CODE_SNIPPET} />
              </StepBox>

              <StepBox n="3" title="Wait for the public URL in Kaggle output">
                <div className="bg-[#080b12] border border-gray-800/40 rounded-xl p-3 font-mono text-[10px] space-y-1">
                  <div className="text-gray-500">Output will show (after ~30 seconds):</div>
                  <div className="text-emerald-400">  BACKEND IS LIVE!</div>
                  <div><span className="text-gray-600">  URL: </span><span className="text-amber-300">https://abc-xyz.trycloudflare.com</span></div>
                  <div className="text-emerald-500">  COPY THIS → paste into Arena Connect Broker field</div>
                </div>
                <div className="mt-2 text-[10px] text-blue-300 bg-blue-500/8 border border-blue-500/20 rounded-lg p-2">
                  <strong>Better URLs</strong> (no browser interstitial): localhost.run or serveo.net URLs are tried first.
                  If you get a trycloudflare.com URL and it fails, open it in a browser tab first.
                </div>
              </StepBox>

              <StepBox n="4" title="Connect from Arena">
                <ol className="list-decimal list-inside space-y-1 text-[11px] text-gray-400">
                  <li>Go to <strong className="text-white">🔐 Connect</strong> tab</li>
                  <li>Paste the URL from Kaggle into the proxy field</li>
                  <li>Fill in API Key, API Secret, today's Session Token</li>
                  <li>Click <strong className="text-indigo-300">Validate Live</strong></li>
                  <li className="text-emerald-400 font-semibold">Should show "Connected via Python SDK!"</li>
                </ol>
              </StepBox>

              <div className="bg-blue-500/8 border border-blue-500/20 rounded-xl p-3 text-[11px]">
                <p className="text-blue-300 font-semibold mb-1">🔑 Daily Session Token</p>
                <ol className="list-decimal list-inside space-y-1 text-gray-400">
                  <li>Open ICICI login URL (from 🔐 Connect tab, after entering API Key)</li>
                  <li>Login: Customer ID + Trading Password + 6-digit TOTP</li>
                  <li>After redirect, copy <code className="text-amber-300">?apisession=XXXXX</code> from URL bar</li>
                  <li>Paste in Session Token field → Validate Live</li>
                </ol>
              </div>

              <button
                onClick={() => {
                  navigator.clipboard.writeText(KAGGLE_CODE_SNIPPET).catch(() => {});
                  setTab('connect');
                }}
                className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition-colors"
              >
                📋 Copy Code → Switch to Connect Tab
              </button>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════
              TAB: DEBUG
              ══════════════════════════════════════════════════════════════ */}
          {tab === 'debug' && (
            <div className="space-y-4">
              <div className="flex gap-2 p-3 bg-purple-500/6 border border-purple-500/20 rounded-xl">
                <Bug size={12} className="text-purple-400 flex-shrink-0 mt-0.5" />
                <p className="text-[11px] text-purple-300">
                  If you keep getting "Request Object is Null", run the Python test below.
                  If Python works → use Kaggle Backend. If Python also fails → credentials are wrong.
                </p>
              </div>

              <div>
                <h4 className="text-white font-semibold text-xs mb-2">Test credentials with Python</h4>
                <CodeBlock lang="test_credentials.py" code={`from breeze_connect import BreezeConnect

api_key      = "${apiKey || 'YOUR_API_KEY'}"
api_secret   = "YOUR_SECRET_KEY"      # replace
apisession   = "${sessionToken || 'PASTE_SESSION_TOKEN'}"

breeze = BreezeConnect(api_key=api_key)

try:
    breeze.generate_session(api_secret=api_secret, session_token=apisession)
    print("SUCCESS! Session key:", breeze.session_key[:12], "...")
    
    # Test order chain fetch
    data = breeze.get_option_chain_quotes(
        stock_code="NIFTY", exchange_code="NFO",
        product_type="options", expiry_date="01-Jul-2025",
        right="Call", strike_price="")
    rows = data.get("Success") or []
    print(f"Option chain: {len(rows)} rows")
    
except Exception as e:
    print("FAILED:", e)
    print()
    print("If this fails → token stale or credentials wrong")
    print("If this works but Arena fails → CORS issue → use Kaggle backend")`} />
              </div>

              <div>
                <h4 className="text-white font-semibold text-xs mb-2">Test order placement with Python</h4>
                <CodeBlock lang="test_order.py" code={`# Run ONLY if you want to place a real order!
# Verified field values for breeze.place_order():

result = breeze.place_order(
    stock_code="NIFTY",
    exchange_code="NFO",
    product="options",          # lowercase
    action="buy",               # "buy" or "sell" (lowercase)
    order_type="market",        # "market" or "limit" (lowercase)
    stoploss="0",
    quantity="65",              # 1 lot = 65 qty for NIFTY
    price="0",                  # "0" for market orders
    validity="day",
    validity_date="01-Jul-2025",
    disclosed_quantity="0",
    expiry_date="01-Jul-2025",
    right="Call",               # "Call" or "Put" (capital first!)
    strike_price="24500",
    user_remark="TestV8"
)
print("Status:", result.get("Status"))
print("Order ID:", (result.get("Success") or {}).get("order_id"))
print("Error:", result.get("Error"))`} />
              </div>

              {lastDebug && (
                <div>
                  <h4 className="text-white font-semibold text-xs mb-2">Last Browser Request</h4>
                  <DebugInspector info={lastDebug} />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ── Small reusable components ─────────────────────────────────────────────────

const INPUT = `w-full bg-[#0a0c15] border border-gray-700/40 focus:border-blue-500/60
              text-white text-xs rounded-xl px-3 py-2.5 outline-none
              placeholder-gray-700 mono transition-colors`;

const Field: React.FC<{ label: string; hint?: string; children: React.ReactNode }> = ({ label, hint, children }) => (
  <div>
    <label className="text-gray-400 text-[11px] font-semibold block mb-1.5">
      {label}
      {hint && <span className="text-gray-700 font-normal ml-1.5">— {hint}</span>}
    </label>
    {children}
  </div>
);

const PresetBtn: React.FC<{ label: string; active: boolean; onClick: () => void; highlight?: boolean }> = ({
  label, active, onClick, highlight,
}) => (
  <button onClick={onClick}
    className={`px-2.5 py-1 text-[9px] rounded-lg border font-mono transition-colors ${
      active
        ? highlight
          ? 'bg-emerald-600/20 border-emerald-500/40 text-emerald-300'
          : 'bg-blue-600/20 border-blue-500/40 text-blue-300'
        : 'bg-[#1a1d2e] border-gray-700/30 text-gray-600 hover:text-gray-300'
    }`}>
    {label}
  </button>
);

const StepBox: React.FC<{ n: string; title: string; children: React.ReactNode }> = ({ n, title, children }) => (
  <div className="space-y-2">
    <div className="flex items-center gap-2">
      <span className="w-5 h-5 bg-blue-600 text-white text-[10px] font-black rounded-full
                       flex items-center justify-center flex-shrink-0">
        {n}
      </span>
      <h4 className="text-white font-bold text-xs">{title}</h4>
    </div>
    <div className="ml-7">{children}</div>
  </div>
);
