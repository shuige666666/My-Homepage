export interface AnimeSubject {
  id: number;
  name: string;
  nameCn: string;
  image: string;
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
  recentReviews: AnimeEntry[];
}
