import { query } from "@/lib/db";
import type { GameCardData } from "@/lib/demo-games";

export type GameDetails = GameCardData & {
  developerId: string;
  developerUsername: string;
  version: string;
  publishedAt: string | null;
  updatedAt: string;
  controls: string;
  instructions: string;
  platform: string[];
  warnings: string[];
  license: string;
  remixEnabled: boolean;
  versionNumber: number | null;
  storageKey: string | null;
  screenshots: string[];
  favoriteCount: number;
  reviewCount: number;
  isDemo: boolean;
};

type GameRow = {
  id: string;
  slug: string;
  title: string;
  description: string;
  genre: string;
  tags_json: string;
  cover_image: string | null;
  status: string;
  is_demo: number;
  version: string;
  entry_point: string;
  controls: string;
  instructions: string;
  platform_json: string;
  content_warnings_json: string;
  license: string;
  remix_enabled: number;
  published_at: string | null;
  updated_at: string;
  developer_id: string;
  developer_username: string;
  developer_name: string;
  version_number: number | null;
  storage_key: string | null;
  average_rating: number | null;
  rating_count: number;
  favorite_count: number;
  review_count: number;
};

function parseArray(raw: string | null | undefined, fallback: string[] = []): string[] {
  try {
    const parsed = JSON.parse(raw ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : fallback;
  } catch {
    return fallback;
  }
}

function mapCard(row: GameRow): GameCardData {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    developer: row.developer_name,
    developerUsername: row.developer_username,
    genre: row.genre,
    description: row.description,
    cover: row.cover_image || "/art/neon-drift.svg",
    accent: "#8c7cff",
    status: row.status,
    isDemo: row.is_demo === 1,
    averageRating: row.average_rating === null ? null : Number(row.average_rating),
    ratingCount: Number(row.rating_count || 0),
    fileVersion: row.version_number ?? undefined,
    entryPoint: row.entry_point,
    tags: parseArray(row.tags_json),
  };
}

const baseSelect = `
  SELECT g.id, g.slug, g.title, g.description, g.genre, g.tags_json, g.cover_image, g.status,
         g.is_demo, g.version, g.entry_point, g.controls, g.instructions, g.platform_json,
         g.content_warnings_json, g.license, g.remix_enabled, g.published_at, g.updated_at,
         g.developer_id, u.username AS developer_username, u.display_name AS developer_name,
         v.version_number, v.storage_key,
         r.average_rating, COALESCE(r.rating_count, 0) AS rating_count,
         COALESCE(f.favorite_count, 0) AS favorite_count,
         COALESCE(rv.review_count, 0) AS review_count
  FROM games g
  JOIN users u ON u.id = g.developer_id
  LEFT JOIN game_versions v ON v.id = (
    SELECT v2.id FROM game_versions v2 WHERE v2.game_id = g.id AND v2.validation_status = 'validated'
    ORDER BY v2.version_number DESC LIMIT 1
  )
  LEFT JOIN (SELECT game_id, AVG(rating) AS average_rating, COUNT(*) AS rating_count FROM ratings GROUP BY game_id) r ON r.game_id = g.id
  LEFT JOIN (SELECT game_id, COUNT(*) AS favorite_count FROM favorites GROUP BY game_id) f ON f.game_id = g.id
  LEFT JOIN (SELECT game_id, COUNT(*) AS review_count FROM reviews WHERE status = 'visible' GROUP BY game_id) rv ON rv.game_id = g.id
`;

export async function searchGames(input: {
  q?: string;
  genre?: string;
  sort?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<GameCardData[]> {
  const where = ["g.status = 'published'", "g.visibility = 'public'"];
  const values: (string | number)[] = [];
  const q = input.q?.trim().slice(0, 100);
  const genre = input.genre?.trim().slice(0, 64);
  if (q) {
    where.push("(LOWER(g.title) LIKE ? OR LOWER(g.description) LIKE ? OR LOWER(g.genre) LIKE ?)");
    const pattern = `%${q.toLowerCase().replace(/[\\%_]/g, "\\$&")}%`;
    values.push(pattern, pattern, pattern);
  }
  if (genre && genre.toLowerCase() !== "all") {
    where.push("LOWER(g.genre) = ?");
    values.push(genre.toLowerCase());
  }
  const sort = input.sort ?? "recent";
  let order = "g.published_at DESC, g.created_at DESC";
  if (sort === "top-rated") order = "r.average_rating DESC, r.rating_count DESC, g.published_at DESC";
  if (sort === "favorites") order = "f.favorite_count DESC, g.published_at DESC";
  const limit = Math.max(1, Math.min(48, input.limit ?? 12));
  const offset = Math.max(0, Math.min(5000, input.offset ?? 0));
  const rows = await query<GameRow>(`${baseSelect} WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT ? OFFSET ?`, [...values, limit, offset]);
  return rows.map(mapCard);
}

export async function getGameBySlug(slug: string): Promise<GameDetails | null> {
  const rows = await query<GameRow>(`${baseSelect} WHERE g.slug = ? AND g.status = 'published' AND g.visibility = 'public' LIMIT 1`, [slug]);
  const row = rows[0];
  return row ? mapDetails(row) : null;
}

export async function getOwnedGameById(id: string): Promise<GameDetails | null> {
  const rows = await query<GameRow>(`${baseSelect} WHERE g.id = ? LIMIT 1`, [id]);
  return rows[0] ? mapDetails(rows[0]) : null;
}

function mapDetails(row: GameRow): GameDetails {
  const card = mapCard(row);
  return {
    ...card,
    developerId: row.developer_id,
    developerUsername: row.developer_username,
    version: row.version,
    publishedAt: row.published_at,
    updatedAt: row.updated_at,
    controls: row.controls,
    instructions: row.instructions,
    platform: parseArray(row.platform_json, ["browser"]),
    warnings: parseArray(row.content_warnings_json),
    license: row.license,
    remixEnabled: row.remix_enabled === 1,
    versionNumber: row.version_number,
    storageKey: row.storage_key,
    screenshots: [],
    favoriteCount: Number(row.favorite_count || 0),
    reviewCount: Number(row.review_count || 0),
    isDemo: row.is_demo === 1,
  };
}

export async function getDemoGameRecords(): Promise<GameCardData[]> {
  const rows = await query<GameRow>(`${baseSelect} WHERE g.is_demo = 1 AND g.status = 'published' AND g.visibility = 'public' ORDER BY g.title`);
  return rows.map(mapCard);
}
