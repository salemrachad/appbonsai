export interface LocationSearchResult {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  country: string;
  admin1?: string;
  timezone?: string;
}

// Open-Meteo geocoding, used by the location search in Settings.
export async function searchLocations(query: string): Promise<LocationSearchResult[]> {
  if (!query || query.trim().length < 2) return [];
  try {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query.trim())}&count=6&language=en&format=json`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.results || []).map((item: any) => ({
      id: item.id,
      name: item.name,
      latitude: item.latitude,
      longitude: item.longitude,
      country: item.country,
      admin1: item.admin1,
      timezone: item.timezone || 'UTC',
    }));
  } catch (err) {
    console.warn('Geocoding search failed', err);
    return [];
  }
}
