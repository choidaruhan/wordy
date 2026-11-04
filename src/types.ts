export type Bindings = {
  DB: D1Database;
  ASSETS: Fetcher;
  DEV_LOGIN?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
};

export type User = {
  id: string;
  email: string;
  display_name: string | null;
  tz_offset_min: number;
  daily_new: number;
  daily_review: number;
  new_card_mode: 'auto' | 'fixed';
  listening_enabled: boolean;
  voice_locale: 'en-US' | 'en-GB';
  voice_rate: number;
  fsrs_params: number[] | null;
};

export type Env = {
  Bindings: Bindings;
  Variables: {
    user: User | null;
  };
};

export type Deck = {
  id: string;
  name: string;
  created_at: string;
  word_count: number;
};

export type WordRow = {
  id: string;
  term: string;
  meaning: string;
  pos: string | null;
  example: string | null;
  example_ko: string | null;
  category: string | null;
  level: string | null;
  pronunciation: string | null;
  audio_url: string | null;
  collocations: string | null;
  synonyms: string | null;
  antonyms: string | null;
  extra_examples_raw: string | null;
  due_at: string | null;
  state: string | null;
};

export type Stats = {
  total: number;
  decks: number;
  learned: number;
  hard: number;
};
