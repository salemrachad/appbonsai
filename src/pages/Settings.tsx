import React from 'react';
import type { ServerStatus } from '../api/types';
import { SettingsView } from '../components/SettingsView';
import { TreeSettings } from '../settings/settings';

interface SettingsPageProps {
  settings: TreeSettings;
  onUpdateSettings: (s: TreeSettings) => void;
  onRefreshTelemetry: () => void;
  serverStatus: ServerStatus | null;
  onOpenDeveloper: () => void;
  onOpenPhotos: () => void;
}

export const Settings: React.FC<SettingsPageProps> = ({ onOpenDeveloper, onOpenPhotos, ...settingsProps }) => (
  <>
    <SettingsView {...settingsProps} onOpenPhotos={onOpenPhotos} />
    <div className="pb-10 -mt-8">
      <button onClick={onOpenDeveloper} className="w-full py-2.5 rounded-full border border-[#D8D2C9] sans text-xs font-semibold text-[#2D332A]/70 hover:border-[#4A6741] hover:text-[#4A6741] cursor-pointer">
        Developer tools: test tree states, health & behaviour debug
      </button>
    </div>
  </>
);
