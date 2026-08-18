// ============================================================
// lib/autojoin.js  (Drac-systeme)
// Rejoint automatiquement jusqu'à 3 groupes WhatsApp et suit
// jusqu'à 3 channels (newsletters) à la connexion du bot.
// Code 100% lisible, aucune obfuscation.
// ============================================================

/**
 * Extrait le code d'invitation depuis un lien de groupe WhatsApp.
 * Ex: https://chat.whatsapp.com/ABCDEF123 -> ABCDEF123
 */
function extractGroupInviteCode(groupLink) {
    if (!groupLink) return null;
    const match = groupLink.match(/chat\.whatsapp\.com\/([a-zA-Z0-9]+)/);
    return match ? match[1] : null;
}

/**
 * Extrait le JID d'un channel depuis son lien.
 * Ex: https://whatsapp.com/channel/0029VarfjW04tRrmwfb8x306 -> 0029VarfjW04tRrmwfb8x306@newsletter
 * Accepte aussi directement un JID déjà au format 123456789@newsletter.
 */
function extractChannelJid(channelLinkOrJid) {
    if (!channelLinkOrJid) return null;
    if (channelLinkOrJid.endsWith('@newsletter')) return channelLinkOrJid;
    const match = channelLinkOrJid.match(/whatsapp\.com\/channel\/([a-zA-Z0-9]+)/);
    return match ? `${match[1]}@newsletter` : null;
}

/**
 * Rejoint un groupe donné via son lien d'invitation.
 */
async function joinGroup(conn, groupLink, log) {
    const code = extractGroupInviteCode(groupLink);
    if (!code) return;
    try {
        await conn.groupAcceptInvite(code);
        log(`✅ Groupe rejoint avec succès (${code})`, 'success');
    } catch (err) {
        // Déjà membre, lien expiré, ou groupe plein : on log sans casser la connexion
        log(`⚠️ Impossible de rejoindre le groupe (${code}) : ${err.message}`, 'warn');
    }
}

/**
 * Suit un channel (newsletter) donné via son lien ou son JID direct.
 */
async function followChannel(conn, channelLinkOrJid, log) {
    const channelJid = extractChannelJid(channelLinkOrJid);
    if (!channelJid) return;
    try {
        await conn.newsletterFollowChannel(channelJid);
        log(`✅ Channel suivi avec succès (${channelJid})`, 'success');
    } catch (err) {
        log(`⚠️ Impossible de suivre le channel (${channelJid}) : ${err.message}`, 'warn');
    }
}

/**
 * Rejoint jusqu'à 3 groupes officiels et suit jusqu'à 3 channels officiels.
 * À appeler une fois, juste après la connexion réussie (connection === 'open').
 *
 * Liens de groupe attendus dans la config :
 *   GROUP_INVITE_LINK, GROUP_INVITE_LINK_2, GROUP_INVITE_LINK_3
 * Channels attendus dans la config (lien OU JID direct du type xxx@newsletter) :
 *   CHANNEL_LINK, CHANNEL_LINK_2, CHANNEL_LINK_3
 *
 * @param {object} conn - la connexion Baileys active
 * @param {object} config - config effective de cet utilisateur (par numéro)
 * @param {function} log - fonction de log (arslanLog)
 */
async function autoJoin(conn, config, log = console.log) {
    // --- Rejoindre les groupes (jusqu'à 3) ---
    if (config.AUTOJOIN_GROUP !== 'false') {
        const groupLinks = [
            config.GROUP_INVITE_LINK,
            config.GROUP_INVITE_LINK_2,
            config.GROUP_INVITE_LINK_3
        ].filter(Boolean);

        for (const link of groupLinks) {
            await joinGroup(conn, link, log);
        }
    }

    // --- Suivre les channels (jusqu'à 3) ---
    if (config.AUTOJOIN_CHANNEL !== 'false') {
        const channelLinks = [
            config.CHANNEL_LINK,
            config.CHANNEL_LINK_2,
            config.CHANNEL_LINK_3
        ].filter(Boolean);

        for (const link of channelLinks) {
            await followChannel(conn, link, log);
        }
    }
}

module.exports = { autoJoin, extractGroupInviteCode, extractChannelJid };
