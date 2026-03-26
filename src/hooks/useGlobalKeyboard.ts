import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export function useGlobalKeyboard() {
  const navigate = useNavigate();

  useEffect(() => {
    let lastKey = '';
    let lastTime = 0;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in an input
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName) || (e.target as HTMLElement).isContentEditable) {
        return;
      }

      const now = Date.now();
      const key = e.key.toLowerCase();
      const isSequence = now - lastTime < 500;

      // Ctrl + K -> Command Palette (placeholder logic for now)
      if ((e.ctrlKey || e.metaKey) && key === 'k') {
        e.preventDefault();
        console.log('[Keyboard] Opening Command Palette');
        // Trigger command palette store or event bus
        return;
      }

      // Shift + B / S
      if (e.shiftKey) {
        if (key === 'b') {
          console.log('[Keyboard] Chain Buy Triggered');
          // Dispatch buy action
          return;
        }
        if (key === 's') {
          console.log('[Keyboard] Chain Sell Triggered');
          // Dispatch sell action
          return;
        }
      }

      // Sequences: g + l (Launchpad), g + m (Market)
      if (isSequence && lastKey === 'g') {
        if (key === 'l') {
          e.preventDefault();
          navigate('/launchpad');
        } else if (key === 'm') {
          e.preventDefault();
          navigate('/market');
        }
        lastKey = ''; // Reset sequence
      } else {
        lastKey = key;
        lastTime = now;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [navigate]);
}
