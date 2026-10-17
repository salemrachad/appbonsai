import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import '@fontsource-variable/inter/wght.css';
import '@fontsource-variable/cormorant-garamond/wght.css';
import '@fontsource-variable/cormorant-garamond/wght-italic.css';
import App from './App.tsx';
import { ErrorScreen } from './components/ErrorScreen';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorScreen>
      <App />
    </ErrorScreen>
  </StrictMode>,
);
