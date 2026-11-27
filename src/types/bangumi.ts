export interface AnimeSubject {
  id: number;
  name: string;
  nameCn: string;
  image: string;
  poster?: { large: string; thumbnail: string };
  bangumiScore: number;
  rank: number | null;
  url: string;
}

export interface AnimeEntry extends AnimeSubject {
  userScore: number;
  comment: string;
  updatedAt: string;
  note?: string;
}

export interface LongReviewSubjectInfo {
  episodes: string;
  airDate: string;
  director: string;
  originalWork: string;
  characterDesign: string;
  raw: string;
}

export interface LongReviewSubject {
  id: number;
  displayName: string;
  nameCn: string;
  originalName: string;
  platform: string;
  url: string;
  info: LongReviewSubjectInfo;
  bangumiScore: number | null;
  bangumiRank: number | null;
  userScore: number | null;
  userComment: string;
  posterPath: string;
  posterWidth: number;
  posterHeight: number;
}

export interface LongReviewMedia {
  src: string;
  width: number;
  height: number;
  kind: "attachment" | "poster" | "custom";
  subjectId?: number;
  label: string;
  caption: string;
}

export interface LongReviewTheme {
  bg: string;
  fg: string;
  accent: string;
}

export interface LongReviewEntry {
  id: number;
  title: string;
  author: string;
  blogUrl: string;
  publishedAt: string;
  updatedAt: string;
  replies: number;
  charCount: number;
  readMinutes: number;
  content: string;
  subjects: LongReviewSubject[];
  primaryVisual: LongReviewMedia | null;
  gallery: LongReviewMedia[];
  theme?: LongReviewTheme;
}

export interface BangumiPageData {
  syncedAt: string;
  profile: {
    username: string;
    nickname: string;
    bangumiUrl: string;
  };
  stats: {
    watched: number;
    watching: number;
    wish: number;
  };
  favorites: AnimeEntry[];
  recentWatched: AnimeEntry[];
  watchHistory?: AnimeEntry[];
  recentReviews: AnimeEntry[];
  longReviews?: LongReviewEntry[];
}
