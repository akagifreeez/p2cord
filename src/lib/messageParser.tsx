import React from 'react';
import { parseEmojis } from './emojiParser';
import { parseMentions, MentionContext, containsCurrentUserMention } from './mentionParser';

/**
 * 統合メッセージパーサー
 * 絵文字、メンション、その他のDiscordマークアップを一括処理
 */

export interface ParseOptions {
    mentionContext?: MentionContext;
    disableEmojis?: boolean;
    disableMentions?: boolean;
}

/**
 * メッセージコンテンツをパース（絵文字 + メンション）
 * パースの順序: メンション → 絵文字（各テキスト部分に対して）
 */
export function parseMessageContent(
    content: string,
    options: ParseOptions = {}
): React.ReactNode[] {
    if (!content) return [];

    let result: React.ReactNode[] = [content];

    // 1. メンションをパース
    if (!options.disableMentions) {
        result = result.flatMap((node) => {
            if (typeof node === 'string') {
                return parseMentions(node, options.mentionContext);
            }
            return node;
        });
    }

    // 2. テキスト部分に対して絵文字をパース
    if (!options.disableEmojis) {
        result = result.flatMap((node) => {
            if (typeof node === 'string') {
                return parseEmojis(node);
            }
            return node;
        });
    }

    return result;
}

/**
 * 自分へのメンションが含まれるメッセージかどうか
 */
export function isMessageMentioningMe(content: string, currentUserId?: string): boolean {
    return containsCurrentUserMention(content, currentUserId);
}

/**
 * メッセージコンポーネント用ラッパー
 */
interface ParsedMessageProps {
    content: string;
    mentionContext?: MentionContext;
    className?: string;
}

export const ParsedMessage: React.FC<ParsedMessageProps> = ({
    content,
    mentionContext,
    className = ''
}) => {
    const parsed = parseMessageContent(content, { mentionContext });

    return (
        <span className={className}>
            {parsed.map((node, i) => (
                <React.Fragment key={i}>{node}</React.Fragment>
            ))}
        </span>
    );
};

// Re-export for convenience
export { parseEmojis, CustomEmoji, getEmojiUrl, isEmojiOnlyMessage } from './emojiParser';
export { parseMentions, Mention, containsCurrentUserMention } from './mentionParser';
export type { MentionContext } from './mentionParser';
