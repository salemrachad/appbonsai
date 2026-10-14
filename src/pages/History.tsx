import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { HistoryView } from '../components/HistoryView';
import type { DailySummary, DiaryItem, PlantEventType } from '../history/historyTypes';

interface HistoryPageProps {
  treeName: string;
  changeKey: string; // changes when new episodes/events exist, so the diary reloads
  onCareLogged: (type: PlantEventType) => void;
}

// The plant diary, read from the local database.
export const History: React.FC<HistoryPageProps> = ({ treeName, changeKey, onCareLogged }) => {
  const [days, setDays] = useState<DailySummary[]>([]);
  const [diary, setDiary] = useState<DiaryItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [d, di] = await Promise.all([api.daily(7), api.diary(3)]);
      setDays(d);
      setDiary(di);
    } catch {
      /* server offline: keep what we have */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, changeKey]);

  const logCare = async (type: PlantEventType, note: string) => {
    await api.logEvent(type, note.trim() || undefined);
    onCareLogged(type);
    await load();
  };

  return <HistoryView days={days} diary={diary} treeName={treeName} loading={loading} onLogCare={logCare} />;
};
