// ═══════════════════════════════════════════════════════════════════════════
//  📁 STOCKAGE COMPLET VIA GITHUB (repo PRIVÉ uniquement)
// ═══════════════════════════════════════════════════════════════════════════
//
//  ⚠️ Remplace lib/database.js (MongoDB) par des fichiers JSON commités dans
//  un dépôt GitHub PRIVÉ. Mêmes noms de fonctions exportés => aucun autre
//  fichier du bot n'a besoin d'être modifié à part le require() dans main.js.
//
//  ⚠️ RISQUES À CONNAÎTRE :
//  - Le fichier de session Baileys équivaut à un mot de passe WhatsApp complet.
//    Repo PRIVÉ obligatoire, jamais public.
//  - L'API GitHub est limitée à 5000 requêtes/heure par token. Les OTP et
//    stats sont donc mis en cache mémoire et ne sont committés que par lots
//    (voir STATS_FLUSH_MS) pour éviter de dépasser cette limite.
//  - Chaque écriture crée un commit permanent : l'historique Git garde une
//    trace de toutes les anciennes sessions même après écrasement du fichier.
//
//  Variables d'environnement requises (Render → Environment) :
//    GITHUB_TOKEN   -> Fine-grained PAT, limité à ce repo, Contents: Read/Write
//    GITHUB_OWNER   -> ton nom d'utilisateur GitHub
//    GITHUB_REPO    -> nom du repo PRIVÉ dédié au stockage
//    GITHUB_BRANCH  -> branche à utiliser (défaut: "main")
// ═══════════════════════════════════════════════════════════════════════════

const GITHUB_API = 'https://api.github.com';
const OWNER = process.env.GITHUB_OWNER;
const REPO = process.env.GITHUB_REPO;
const BRANCH = process.env.GITHUB_BRANCH || 'main';
const TOKEN = process.env.GITHUB_TOKEN;

const STATS_FLUSH_MS = 5 * 60 * 1000; // stats écrites sur GitHub toutes les 5 min max

function assertConfigured() {
    if (!TOKEN || !OWNER || !REPO) {
        throw new Error('❌ GITHUB_TOKEN, GITHUB_OWNER et GITHUB_REPO doivent être définis.');
    }
}

function headers() {
    return {
        'Authorization': `Bearer ${TOKEN}`,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28'
    };
}

function clean(number) {
    return String(number).replace(/[^0-9]/g, '');
}

// ────────────────────────────────────────────────────────────────────────────
// Primitives génériques de lecture/écriture d'un fichier JSON sur GitHub
// ────────────────────────────────────────────────────────────────────────────

async function ghGetFile(path) {
    const res = await fetch(`${GITHUB_API}/repos/${OWNER}/${REPO}/contents/${path}?ref=${BRANCH}`, { headers: headers() });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GitHub GET ${path} failed: ${res.status} ${await res.text()}`);
    const data = await res.json();
    return { sha: data.sha, json: JSON.parse(Buffer.from(data.content, 'base64').toString('utf-8')) };
}

async function ghPutFile(path, jsonValue, message) {
    const existing = await ghGetFile(path).catch(() => null);
    const body = {
        message,
        content: Buffer.from(JSON.stringify(jsonValue, null, 2)).toString('base64'),
        branch: BRANCH
    };
    if (existing) body.sha = existing.sha;
    const res = await fetch(`${GITHUB_API}/repos/${OWNER}/${REPO}/contents/${path}`, {
        method: 'PUT', headers: headers(), body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`GitHub PUT ${path} failed: ${res.status} ${await res.text()}`);
    return true;
}

async function ghDeleteFile(path, message) {
    const existing = await ghGetFile(path).catch(() => null);
    if (!existing) return true;
    const res = await fetch(`${GITHUB_API}/repos/${OWNER}/${REPO}/contents/${path}`, {
        method: 'DELETE', headers: headers(),
        body: JSON.stringify({ message, sha: existing.sha, branch: BRANCH })
    });
    if (!res.ok) throw new Error(`GitHub DELETE ${path} failed: ${res.status} ${await res.text()}`);
    return true;
}

// ────────────────────────────────────────────────────────────────────────────
// "Connexion" (juste une vérification que le repo est accessible)
// ────────────────────────────────────────────────────────────────────────────

const connectdb = async () => {
    try {
        assertConfigured();
        const res = await fetch(`${GITHUB_API}/repos/${OWNER}/${REPO}`, { headers: headers() });
        if (!res.ok) throw new Error(`Repo inaccessible: ${res.status}`);
        const repoInfo = await res.json();
        if (!repoInfo.private) {
            console.warn('⚠️ ATTENTION : ce dépôt GitHub est PUBLIC. Les sessions WhatsApp y seraient exposées à tout le monde. Rends-le privé immédiatement.');
        }
        console.log('✅ GitHub Storage Connected Successfully');
    } catch (e) {
        console.error('❌ GitHub Storage Connection Failed:', e.message);
    }
};

// ────────────────────────────────────────────────────────────────────────────
// SESSIONS  (sessions/<number>.json)
// ────────────────────────────────────────────────────────────────────────────

async function saveSessionToMongoDB(number, credentials) {
    try {
        const n = clean(number);
        await ghPutFile(`sessions/${n}.json`, { credentials, updatedAt: new Date().toISOString() }, `session: update ${n}`);
        console.log(`📁 Session saved to GitHub for ${n}`);
        return true;
    } catch (error) {
        console.error('❌ Error saving session to GitHub:', error.message);
        return false;
    }
}

async function getSessionFromMongoDB(number) {
    try {
        const n = clean(number);
        const file = await ghGetFile(`sessions/${n}.json`);
        return file ? file.json.credentials : null;
    } catch (error) {
        console.error('❌ Error getting session from GitHub:', error.message);
        return null;
    }
}

async function deleteSessionFromMongoDB(number) {
    try {
        const n = clean(number);
        await ghDeleteFile(`sessions/${n}.json`, `session: delete ${n}`);
        await ghDeleteFile(`active-numbers/${n}.json`, `active-number: delete ${n}`);
        console.log(`🗑️ Session deleted from GitHub for ${n}`);
        return true;
    } catch (error) {
        console.error('❌ Error deleting session from GitHub:', error.message);
        return false;
    }
}

// ────────────────────────────────────────────────────────────────────────────
// CONFIG UTILISATEUR  (configs/<number>.json)
// ────────────────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG = {
    AUTO_RECORDING: 'false',
    AUTO_TYPING: 'false',
    ANTI_CALL: 'false',
    REJECT_MSG: '*🔕 ʏᴏᴜʀ ᴄᴀʟʟ ᴡᴀs ᴀᴜᴛᴏᴍᴀᴛɪᴄᴀʟʟʏ ʀᴇᴊᴇᴄᴛᴇᴅ..!*',
    READ_MESSAGE: 'false',
    AUTO_VIEW_STATUS: 'true',
    AUTO_LIKE_STATUS: 'true',
    AUTO_STATUS_REPLY: 'false',
    AUTO_STATUS_MSG: 'Hello from black popkid!',
    AUTO_LIKE_EMOJI: ['❤️', '👍', '😮', '😎'],
    ANTIDELETE: 'true'
};

async function getUserConfigFromMongoDB(number) {
    try {
        const n = clean(number);
        const file = await ghGetFile(`configs/${n}.json`);
        if (file) return file.json;
        await ghPutFile(`configs/${n}.json`, DEFAULT_CONFIG, `config: create default for ${n}`);
        return DEFAULT_CONFIG;
    } catch (error) {
        console.error('❌ Error getting user config from GitHub:', error.message);
        return { ANTIDELETE: 'true' };
    }
}

async function updateUserConfigInMongoDB(number, newConfig) {
    try {
        const n = clean(number);
        const existing = await ghGetFile(`configs/${n}.json`);
        const updated = { ...(existing ? existing.json : DEFAULT_CONFIG), ...newConfig };
        await ghPutFile(`configs/${n}.json`, updated, `config: update ${n}`);
        console.log(`⚙️ Config updated for ${n}`);
        return true;
    } catch (error) {
        console.error('❌ Error updating user config in GitHub:', error.message);
        return false;
    }
}

// ────────────────────────────────────────────────────────────────────────────
// OTP  (otp/<number>.json) — courte durée de vie, vérifiée puis supprimée
// ────────────────────────────────────────────────────────────────────────────

async function saveOTPToMongoDB(number, otp, config) {
    try {
        const n = clean(number);
        const expiresAt = new Date(Date.now() + 5 * 60000).toISOString();
        await ghPutFile(`otp/${n}.json`, { otp, config, expiresAt }, `otp: save for ${n}`);
        console.log(`🔐 OTP saved for ${n}`);
        return true;
    } catch (error) {
        console.error('❌ Error saving OTP to GitHub:', error.message);
        return false;
    }
}

async function verifyOTPFromMongoDB(number, otp) {
    try {
        const n = clean(number);
        const file = await ghGetFile(`otp/${n}.json`);
        if (!file) return { valid: false, error: 'Invalid or expired OTP' };
        const { otp: storedOtp, config, expiresAt } = file.json;
        if (storedOtp !== otp || new Date(expiresAt) < new Date()) {
            return { valid: false, error: 'Invalid or expired OTP' };
        }
        await ghDeleteFile(`otp/${n}.json`, `otp: consumed for ${n}`);
        return { valid: true, config };
    } catch (error) {
        console.error('❌ Error verifying OTP from GitHub:', error.message);
        return { valid: false, error: 'Verification error' };
    }
}

// ────────────────────────────────────────────────────────────────────────────
// NUMÉROS ACTIFS  (active-numbers/<number>.json)
// ────────────────────────────────────────────────────────────────────────────

async function addNumberToMongoDB(number) {
    try {
        const n = clean(number);
        await ghPutFile(`active-numbers/${n}.json`, { lastConnected: new Date().toISOString(), isActive: true }, `active-number: add ${n}`);
        return true;
    } catch (error) {
        console.error('❌ Error adding number to GitHub:', error.message);
        return false;
    }
}

async function removeNumberFromMongoDB(number) {
    try {
        const n = clean(number);
        await ghDeleteFile(`active-numbers/${n}.json`, `active-number: remove ${n}`);
        return true;
    } catch (error) {
        console.error('❌ Error removing number from GitHub:', error.message);
        return false;
    }
}

async function getAllNumbersFromMongoDB() {
    try {
        const res = await fetch(`${GITHUB_API}/repos/${OWNER}/${REPO}/contents/active-numbers?ref=${BRANCH}`, { headers: headers() });
        if (res.status === 404) return [];
        if (!res.ok) throw new Error(`GitHub GET active-numbers failed: ${res.status}`);
        const files = await res.json();
        return files.map(f => f.name.replace('.json', ''));
    } catch (error) {
        console.error('❌ Error getting numbers from GitHub:', error.message);
        return [];
    }
}

// ────────────────────────────────────────────────────────────────────────────
// STATISTIQUES — mise en cache mémoire, flush périodique vers GitHub
// (pour éviter un commit à CHAQUE message/commande, ce qui exploserait la
// limite de 5000 requêtes/heure de l'API GitHub)
// ────────────────────────────────────────────────────────────────────────────

const statsCache = new Map(); // clé "number:date" -> { commandsUsed, messagesReceived, messagesSent, groupsInteracted }
const dirtyStats = new Set();

function statsKey(number, date) { return `${number}:${date}`; }

async function incrementStats(number, field) {
    const n = clean(number);
    const today = new Date().toISOString().split('T')[0];
    const key = statsKey(n, today);
    const current = statsCache.get(key) || { number: n, date: today, commandsUsed: 0, messagesReceived: 0, messagesSent: 0, groupsInteracted: 0 };
    current[field] = (current[field] || 0) + 1;
    statsCache.set(key, current);
    dirtyStats.add(key);
    // pas d'écriture GitHub ici — voir flushStatsToGitHub()
}

async function flushStatsToGitHub() {
    if (dirtyStats.size === 0) return;
    const keys = [...dirtyStats];
    dirtyStats.clear();
    for (const key of keys) {
        const [n, date] = key.split(':');
        const stat = statsCache.get(key);
        try {
            const path = `stats/${n}/${date}.json`;
            const existing = await ghGetFile(path);
            const merged = existing ? {
                ...existing.json,
                commandsUsed: (existing.json.commandsUsed || 0) + stat.commandsUsed,
                messagesReceived: (existing.json.messagesReceived || 0) + stat.messagesReceived,
                messagesSent: (existing.json.messagesSent || 0) + stat.messagesSent,
                groupsInteracted: (existing.json.groupsInteracted || 0) + stat.groupsInteracted
            } : stat;
            await ghPutFile(path, merged, `stats: flush ${n} ${date}`);
            // reset le delta local une fois committé
            statsCache.set(key, { number: n, date, commandsUsed: 0, messagesReceived: 0, messagesSent: 0, groupsInteracted: 0 });
        } catch (error) {
            console.error(`❌ Error flushing stats for ${key}:`, error.message);
            dirtyStats.add(key); // on réessaiera au prochain flush
        }
    }
}

setInterval(() => { flushStatsToGitHub().catch(e => console.error('❌ flushStatsToGitHub:', e.message)); }, STATS_FLUSH_MS);
// flush aussi à l'arrêt du process pour ne pas perdre les derniers compteurs
process.on('SIGTERM', () => { flushStatsToGitHub(); });
process.on('SIGINT', () => { flushStatsToGitHub(); });

async function getStatsForNumber(number) {
    try {
        const n = clean(number);
        const res = await fetch(`${GITHUB_API}/repos/${OWNER}/${REPO}/contents/stats/${n}?ref=${BRANCH}`, { headers: headers() });
        if (res.status === 404) return [];
        if (!res.ok) throw new Error(`GitHub GET stats/${n} failed: ${res.status}`);
        const files = await res.json();
        const sorted = files.sort((a, b) => b.name.localeCompare(a.name)).slice(0, 30);
        const results = [];
        for (const f of sorted) {
            const file = await ghGetFile(`stats/${n}/${f.name}`);
            if (file) results.push(file.json);
        }
        return results;
    } catch (error) {
        console.error('❌ Error getting stats from GitHub:', error.message);
        return [];
    }
}

// =================================
// EXPORTS — mêmes noms que lib/database.js, aucun autre fichier à changer
// à part le require() dans main.js
// =================================

module.exports = {
    connectdb,

    // Fonctions session
    saveSessionToMongoDB,
    getSessionFromMongoDB,
    deleteSessionFromMongoDB,

    // Fonctions configuration
    getUserConfigFromMongoDB,
    updateUserConfigInMongoDB,

    // Fonctions OTP
    saveOTPToMongoDB,
    verifyOTPFromMongoDB,

    // Fonctions numéros
    addNumberToMongoDB,
    removeNumberFromMongoDB,
    getAllNumbersFromMongoDB,

    // Fonctions statistiques
    incrementStats,
    getStatsForNumber,
    flushStatsToGitHub,

    // Anciennes fonctions (pour compatibilité)
    getUserConfig: async (number) => {
        const config = await getUserConfigFromMongoDB(number);
        return config || {};
    },
    updateUserConfig: updateUserConfigInMongoDB
};
