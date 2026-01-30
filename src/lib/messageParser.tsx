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
 * メッセージコンテンツをパース（絵文字 + メンション + Markdown）
 * パースの順序: 
 * 1. コードブロック/インラインコード (未実装)
 * 2. メンション
 * 3. Markdown (Bold, Italic, etc)
 * 4. 絵文字
 */
export function parseMessageContent(
    content: string,
    options: ParseOptions = {}
): React.ReactNode[] {
    if (!content) return [];

    let result: React.ReactNode[] = [content];

    // TODO: Implement Code Block support properly

    // 1. メンションをパース
    if (!options.disableMentions) {
        result = result.flatMap((node) => {
            if (typeof node === 'string') {
                return parseMentions(node, options.mentionContext);
            }
            return node;
        });
    }

    // 2. 基本的なMarkdown（太字、斜体、打ち消し、スポイラー、インラインコード）
    result = result.flatMap((node) => {
        if (typeof node === 'string') {
            return parseMarkdown(node);
        }
        return node;
    });

    // 3. テキスト部分に対して絵文字をパース
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
 * Basic Markdown Parser
 * Handles: **Bold**, *Italic*, ~~Strike~~, ||Spoiler||, `Code`
 */
function parseMarkdown(text: string): React.ReactNode[] {
    let nodes: React.ReactNode[] = [text];

    const process = (regex: RegExp, render: (content: string, i: number) => React.ReactNode, contentGroupIndex = 1) => {
        const nextNodes: React.ReactNode[] = [];
        nodes.forEach((node) => {
            if (typeof node !== 'string') {
                nextNodes.push(node);
                return;
            }

            const parts = [];
            let lastIndex = 0;
            const matches = [...node.matchAll(regex)];

            if (matches.length === 0) {
                nextNodes.push(node);
                return;
            }

            matches.forEach((m, i) => {
                const index = m.index!;
                if (index > lastIndex) {
                    parts.push(node.substring(lastIndex, index));
                }
                parts.push(render(m[contentGroupIndex], i)); // Use specific group
                lastIndex = index + m[0].length;
            });

            if (lastIndex < node.length) {
                parts.push(node.substring(lastIndex));
            }
            nextNodes.push(...parts);
        });
        nodes = nextNodes;
    };

    // 1. Inline Code (`code`)
    process(/`([^`]+)`/g, (c, i) => (
        <code key={`code-${i}-${c.substring(0, 5)}`} className="bg-gray-800 px-1 py-0.5 rounded font-mono text-sm text-gray-200">{c}</code>
    ));

    // 2. Spoiler (||text||)
    process(/\|\|(.+?)\|\|/g, (c, i) => (
        <span key={`spoiler-${i}-${c.substring(0, 5)}`} className="bg-gray-700 text-transparent hover:text-gray-200 rounded px-1 cursor-pointer transition-colors duration-200 select-none hover:select-text selection:text-transparent hover:selection:text-gray-200">
            {c}
        </span>
    ));

    // 3. Bold (**text**)
    process(/\*\*(.+?)\*\*/g, (c, i) => (
        <strong key={`bold-${i}-${c.substring(0, 5)}`} className="font-bold text-gray-200">{c}</strong>
    ));

    // 4. Italic (*text*)
    process(/\*(.+?)\*/g, (c, i) => (
        <em key={`italic-${i}-${c.substring(0, 5)}`} className="italic text-gray-300">{c}</em>
    ));

    // 5. Strike (~~text~~)
    process(/~~(.+?)~~/g, (c, i) => (
        <span key={`strike-${i}-${c.substring(0, 5)}`} className="line-through text-gray-500">{c}</span>
    ));

    return nodes;
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
