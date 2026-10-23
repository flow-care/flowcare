-- Permissões por membro: o papel vira apenas um preset que preenche esta lista.
-- Vazio significa "usar o preset do papel", então nenhum backfill é necessário.
ALTER TABLE "Membership"
  ADD COLUMN "permissions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- ADMIN_PROFESSIONAL deixa de existir como preset. As linhas existentes viram
-- ADMIN com leitura clínica de toda a clínica, preservando o alcance que tinham.
UPDATE "Membership"
SET "role" = 'ADMIN',
    "permissions" = ARRAY[
      'organizations:read','patients:read','patients:write',
      'patients:read_history_summary','appointments:read','appointments:write',
      'reception:read','dashboard:read','team:read','team:invite','team:manage',
      'roles:read','usage:read','settings:read','settings:write','audit:read',
      'patients:read_history','patients:attachments:read',
      'patients:attachments:write','consultations:read','consultations:write',
      'consultations:approve','documents:read','documents:write',
      'documents:issue','documents:void','templates:read','templates:write',
      'clinical:read_all','reception:write','communications:read',
      'communications:write'
    ]::TEXT[]
WHERE "role" = 'ADMIN_PROFESSIONAL';
