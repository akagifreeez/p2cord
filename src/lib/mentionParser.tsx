import React from 'react';

/**
 * Discordメンションパーサー
 * ユーザー、ロール、チャンネルメンションをハイライト表示に変換
 */

// メンションパターン
const USER_MENTION_REGEX = /<@!?(\d+)>/g;      // <@123> または <@!123>
const ROLE_MENTION_REGEX = /<@&(\d+)>/g;       // <@&123>
const CHANNEL_MENTION_REGEX = /<#(\d+)>/g;     // <#123>
const EVERYONE_REGEX = /@(everyone|here)/g;   // @everyone, @here

type MentionType = 'user' | 'role' | 'channel' | 'everyone';

interface MentionMatch {
    fullMatch: string;
    type: MentionType;
    id: string;
    index: number;
}

interface MemberInfo {
    id: string;
    name: string;
    nick?: string;
    color?: string;
}

interface RoleInfo {
    id: string;
    name: string;
    color?: string;
}

interface ChannelInfo {
    id: string;
    name: string;
}

export interface MentionContext {
    members?: Map<string, MemberInfo>;
    roles?: Map<string, RoleInfo>;
    channels?: Map<string, ChannelInfo>;
    currentUserId?: string;
}

/**
 * テキストからメンションを検出
 */
function findMentions(text: string): MentionMatch[] {
    const matches: MentionMatch[] = [];

    // ユーザーメンション
    let match;
    USER_MENTION_REGEX.lastIndex = 0;
    while ((match = USER_MENTION_REGEX.exec(text)) !== null) {
        matches.push({
            fullMatch: match[0],
            type: 'user',
            id: match[1],
            index: match.index,
        });
    }

    // ロールメンション
    ROLE_MENTION_REGEX.lastIndex = 0;
    while ((match = ROLE_MENTION_REGEX.exec(text)) !== null) {
        matches.push({
            fullMatch: match[0],
            type: 'role',
            id: match[1],
            index: match.index,
        });
    }

    // チャンネルメンション
    CHANNEL_MENTION_REGEX.lastIndex = 0;
    while ((match = CHANNEL_MENTION_REGEX.exec(text)) !== null) {
        matches.push({
            fullMatch: match[0],
            type: 'channel',
            id: match[1],
            index: match.index,
        });
    }

    // @everyone, @here
    EVERYONE_REGEX.lastIndex = 0;
    while ((match = EVERYONE_REGEX.exec(text)) !== null) {
        matches.push({
            fullMatch: match[0],
            type: 'everyone',
            id: match[1], // 'everyone' or 'here'
            index: match.index,
        });
    }

    // インデックス順にソート
    return matches.sort((a, b) => a.index - b.index);
}

/**
 * メンションコンポーネント
 */
interface MentionProps {
    type: MentionType;
    displayText: string;
    color?: string;
    isCurrentUser?: boolean;
    onClick?: () => void;
}

export const Mention: React.FC<MentionProps> = ({
    type,
    displayText,
    color,
    isCurrentUser,
    onClick
}) => {
    const baseClass = 'px-0.5 rounded font-medium cursor-pointer hover:underline';

    // タイプ別スタイル
    const typeStyles: Record<MentionType, string> = {
        user: 'bg-blue-500/20 text-blue-400',
        role: color ? '' : 'bg-purple-500/20 text-purple-400',
        channel: 'bg-blue-500/20 text-blue-400',
        everyone: 'bg-yellow-500/20 text-yellow-400',
    };

    // 自分へのメンションは強調
    const currentUserStyle = isCurrentUser ? 'bg-yellow-500/30 text-yellow-300' : '';

    const style = color ? {
        backgroundColor: `${color}20`,
        color: color,
    } : undefined;

    return (
        <span
            className={`${baseClass} ${typeStyles[type]} ${currentUserStyle}`}
            style={style}
            onClick={onClick}
        >
            {displayText}
        </span>
    );
};

/**
 * テキスト内のメンションをReact要素に変換
 */
export function parseMentions(
    text: string,
    context: MentionContext = {}
): React.ReactNode[] {
    const mentions = findMentions(text);

    if (mentions.length === 0) {
        return [text];
    }

    const result: React.ReactNode[] = [];
    let lastIndex = 0;

    mentions.forEach((mention, i) => {
        // メンションの前のテキスト
        if (mention.index > lastIndex) {
            result.push(text.slice(lastIndex, mention.index));
        }

        // メンション表示テキストを解決
        let displayText = '';
        let color: string | undefined;
        let isCurrentUser = false;

        switch (mention.type) {
            case 'user': {
                const member = context.members?.get(mention.id);
                displayText = `@${member?.nick || member?.name || 'Unknown User'}`;
                isCurrentUser = mention.id === context.currentUserId;
                break;
            }
            case 'role': {
                const role = context.roles?.get(mention.id);
                displayText = `@${role?.name || 'Unknown Role'}`;
                color = role?.color;
                break;
            }
            case 'channel': {
                const channel = context.channels?.get(mention.id);
                displayText = `#${channel?.name || 'unknown-channel'}`;
                break;
            }
            case 'everyone': {
                displayText = `@${mention.id}`; // 'everyone' or 'here'
                break;
            }
        }

        result.push(
            <Mention
                key={`mention-${i}-${mention.id}`}
                type={mention.type}
                displayText={displayText}
                color={color}
                isCurrentUser={isCurrentUser}
            />
        );

        lastIndex = mention.index + mention.fullMatch.length;
    });

    // 残りのテキスト
    if (lastIndex < text.length) {
        result.push(text.slice(lastIndex));
    }

    return result;
}

/**
 * 自分へのメンションが含まれるか判定
 */
export function containsCurrentUserMention(text: string, currentUserId?: string): boolean {
    if (!currentUserId) return false;

    const userMentionPattern = new RegExp(`<@!?${currentUserId}>`, 'g');
    return userMentionPattern.test(text) || /@everyone|@here/.test(text);
}
