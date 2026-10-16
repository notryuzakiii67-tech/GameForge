export type Migration = { version: string; statements: string[] };

export const migrations: Migration[] = [
  {
    version: "0001_core",
    statements: [
      `CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user',
        account_status TEXT NOT NULL DEFAULT 'active',
        avatar TEXT,
        bio TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS developer_profiles (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        studio_name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        website TEXT,
        verification_status TEXT NOT NULL DEFAULT 'unverified',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS games (
        id TEXT PRIMARY KEY,
        developer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        description TEXT NOT NULL DEFAULT '',
        genre TEXT NOT NULL DEFAULT 'Experimental',
        tags_json TEXT NOT NULL DEFAULT '[]',
        cover_image TEXT,
        status TEXT NOT NULL DEFAULT 'draft',
        visibility TEXT NOT NULL DEFAULT 'public',
        version TEXT NOT NULL DEFAULT '1.0.0',
        entry_point TEXT NOT NULL DEFAULT 'index.html',
        controls TEXT NOT NULL DEFAULT '',
        instructions TEXT NOT NULL DEFAULT '',
        platform_json TEXT NOT NULL DEFAULT '["browser"]',
        content_warnings_json TEXT NOT NULL DEFAULT '[]',
        license TEXT NOT NULL DEFAULT 'all-rights-reserved',
        remix_enabled INTEGER NOT NULL DEFAULT 0,
        source_project_id TEXT,
        is_demo INTEGER NOT NULL DEFAULT 0,
        published_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS game_versions (
        id TEXT PRIMARY KEY,
        game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        version_number INTEGER NOT NULL,
        storage_key TEXT NOT NULL,
        entry_point TEXT NOT NULL,
        file_size INTEGER NOT NULL,
        content_hash TEXT NOT NULL,
        validation_status TEXT NOT NULL,
        changelog TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        UNIQUE(game_id, version_number)
      )`,
      `CREATE TABLE IF NOT EXISTS game_tags (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE
      )`,
      `CREATE TABLE IF NOT EXISTS game_tag_relations (
        game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        tag_id TEXT NOT NULL REFERENCES game_tags(id) ON DELETE CASCADE,
        PRIMARY KEY (game_id, tag_id)
      )`,
      `CREATE TABLE IF NOT EXISTS favorites (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        PRIMARY KEY (user_id, game_id)
      )`,
      `CREATE TABLE IF NOT EXISTS follows (
        follower_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        followed_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        PRIMARY KEY (follower_id, followed_id),
        CHECK (follower_id <> followed_id)
      )`,
      `CREATE TABLE IF NOT EXISTS ratings (
        id TEXT PRIMARY KEY,
        game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(game_id, user_id)
      )`,
      `CREATE TABLE IF NOT EXISTS reviews (
        id TEXT PRIMARY KEY,
        game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'visible',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(game_id, user_id)
      )`,
      `CREATE TABLE IF NOT EXISTS comments (
        id TEXT PRIMARY KEY,
        game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        parent_id TEXT REFERENCES comments(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'visible',
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS collections (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        visibility TEXT NOT NULL DEFAULT 'private',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS collection_games (
        collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
        game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        position INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (collection_id, game_id)
      )`,
      `CREATE TABLE IF NOT EXISTS ai_projects (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        genre TEXT NOT NULL DEFAULT 'Experimental',
        visibility TEXT NOT NULL DEFAULT 'private',
        status TEXT NOT NULL DEFAULT 'draft',
        source_project_id TEXT REFERENCES ai_projects(id) ON DELETE SET NULL,
        allow_remix INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS ai_project_versions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES ai_projects(id) ON DELETE CASCADE,
        version_number INTEGER NOT NULL,
        prompt_summary TEXT NOT NULL DEFAULT '',
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        manifest_json TEXT NOT NULL,
        validation_status TEXT NOT NULL,
        change_summary TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        UNIQUE(project_id, version_number)
      )`,
      `CREATE TABLE IF NOT EXISTS ai_generations (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        project_id TEXT REFERENCES ai_projects(id) ON DELETE SET NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        error_code TEXT,
        input_token_count INTEGER,
        output_token_count INTEGER
      )`,
      `CREATE TABLE IF NOT EXISTS reports (
        id TEXT PRIMARY KEY,
        reporter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        details TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'open',
        created_at TEXT NOT NULL,
        reviewed_at TEXT,
        reviewer_id TEXT REFERENCES users(id) ON DELETE SET NULL
      )`,
      `CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        message TEXT NOT NULL,
        href TEXT,
        read_at TEXT,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY,
        actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        event_type TEXT NOT NULL,
        target_type TEXT,
        target_id TEXT,
        details_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS rate_limits (
        bucket_key TEXT PRIMARY KEY,
        count INTEGER NOT NULL,
        reset_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_games_status_published ON games(status, published_at)`,
      `CREATE INDEX IF NOT EXISTS idx_games_developer ON games(developer_id, updated_at)`,
      `CREATE INDEX IF NOT EXISTS idx_games_genre ON games(genre, status)`,
      `CREATE INDEX IF NOT EXISTS idx_versions_game ON game_versions(game_id, version_number)`,
      `CREATE INDEX IF NOT EXISTS idx_sessions_user_expiry ON sessions(user_id, expires_at)`,
      `CREATE INDEX IF NOT EXISTS idx_ai_projects_owner ON ai_projects(owner_id, updated_at)`,
      `CREATE INDEX IF NOT EXISTS idx_ai_projects_public ON ai_projects(visibility, status, updated_at)`,
      `CREATE INDEX IF NOT EXISTS idx_ai_versions_project ON ai_project_versions(project_id, version_number)`,
      `CREATE INDEX IF NOT EXISTS idx_ai_generations_user_time ON ai_generations(user_id, started_at)`,
      `CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status, created_at)`,
      `CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at)`,
      `CREATE INDEX IF NOT EXISTS idx_reviews_game ON reviews(game_id, status, created_at)`
    ],
  },
  {
    version: "0002_one_running_ai_generation_per_user",
    statements: [
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_generations_one_running_per_user ON ai_generations(user_id) WHERE status = 'running'`,
    ],
  },
  {
    version: "0003_username_first_accounts_and_recovery_contacts",
    statements: [
      `ALTER TABLE users ADD COLUMN email_verified_at TEXT`,
      `ALTER TABLE users ADD COLUMN phone TEXT`,
      `ALTER TABLE users ADD COLUMN phone_verified_at TEXT`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_case_insensitive ON users(LOWER(username))`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_case_insensitive ON users(LOWER(email))`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone_unique ON users(phone) WHERE phone IS NOT NULL`,
    ],
  },
  {
    version: "0004_account_recovery_challenges",
    statements: [
      `CREATE TABLE IF NOT EXISTS account_recovery_challenges (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        purpose TEXT NOT NULL CHECK (purpose IN ('verify_email', 'password_reset')),
        contact TEXT NOT NULL,
        code_hash TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
        expires_at TEXT NOT NULL,
        verified_at TEXT,
        consumed_at TEXT,
        reset_token_hash TEXT,
        reset_expires_at TEXT,
        reset_used_at TEXT,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_recovery_user_purpose ON account_recovery_challenges(user_id, purpose, created_at)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_recovery_reset_token ON account_recovery_challenges(reset_token_hash) WHERE reset_token_hash IS NOT NULL`,
    ],
  },
  {
    version: "0005_private_asset_uploads",
    statements: [
      `CREATE TABLE IF NOT EXISTS assets (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        project_id TEXT REFERENCES ai_projects(id) ON DELETE SET NULL,
        original_name TEXT NOT NULL,
        extension TEXT NOT NULL,
        format TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL CHECK (category IN ('image', 'model', 'audio')),
        mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
        size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
        content_hash TEXT NOT NULL DEFAULT '',
        storage_key TEXT NOT NULL UNIQUE,
        upload_status TEXT NOT NULL CHECK (upload_status IN ('pending_upload', 'ready', 'failed')),
        publication_status TEXT NOT NULL DEFAULT 'private' CHECK (publication_status IN ('private', 'pending_review', 'published', 'rejected', 'removed')),
        validation_state TEXT NOT NULL DEFAULT 'pending',
        validation_json TEXT NOT NULL DEFAULT '{}',
        license TEXT,
        rights_confirmed INTEGER NOT NULL DEFAULT 0 CHECK (rights_confirmed IN (0, 1)),
        attribution TEXT NOT NULL DEFAULT '',
        upload_expires_at TEXT,
        deleted_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_assets_owner_created ON assets(owner_id, created_at DESC) WHERE deleted_at IS NULL`,
      `CREATE INDEX IF NOT EXISTS idx_assets_project ON assets(project_id, created_at) WHERE project_id IS NOT NULL`,
      `CREATE INDEX IF NOT EXISTS idx_assets_upload_expiry ON assets(upload_status, upload_expires_at) WHERE upload_status = 'pending_upload'`,
    ],
  },
  {
    version: "0006_versioned_project_asset_bindings",
    statements: [
      `CREATE TABLE IF NOT EXISTS project_asset_bindings (
        project_id TEXT NOT NULL,
        version_number INTEGER NOT NULL,
        owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        PRIMARY KEY (project_id, version_number, asset_id),
        FOREIGN KEY (project_id, version_number) REFERENCES ai_project_versions(project_id, version_number) ON DELETE CASCADE
      )`,
      `CREATE INDEX IF NOT EXISTS idx_project_asset_bindings_asset ON project_asset_bindings(asset_id)`,
      `CREATE INDEX IF NOT EXISTS idx_project_asset_bindings_owner_version ON project_asset_bindings(owner_id, project_id, version_number)`,
      `CREATE TABLE IF NOT EXISTS project_preview_grants (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        version_number INTEGER NOT NULL,
        owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (project_id, version_number) REFERENCES ai_project_versions(project_id, version_number) ON DELETE CASCADE
      )`,
      `CREATE INDEX IF NOT EXISTS idx_project_preview_grants_expiry ON project_preview_grants(expires_at)`,
      `CREATE INDEX IF NOT EXISTS idx_project_preview_grants_project_version ON project_preview_grants(project_id, version_number, expires_at)`,
    ],
  },
];
