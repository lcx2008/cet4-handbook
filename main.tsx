import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppProvider } from './state/AppContext';
import App from './App';
import { initPwa } from './pwa';
import { applyTheme } from './core/theme';
import { loadSettings } from './core/progressStore';
import { warmUpVoices } from './core/audioFeedback';
import './styles/global.css';

initPwa();
applyTheme(loadSettings().theme);
// 启动时先把系统语音包读出来：等用户点 🔊 时语音列表已经就绪，
// 没有英文包就能当场走在线发音（在用户手势里），不会因为异步等待被浏览器拦掉
warmUpVoices();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </StrictMode>,
);
