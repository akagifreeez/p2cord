import React from 'react';

/**
 * Discord絵文字パーサー
 * カスタム絵文字 <:name:id> および <a:name:id> を画像に変換
 */

// 絵文字パターン: <:name:id> または <a:name:id>（アニメーション）
const CUSTOM_EMOJI_REGEX = /<(a)?:(\w+):(\d+)>/g;

// Unicode絵文字をそのまま表示（ブラウザネイティブ）
// 将来的にTwemojiなどに置き換え可能

interface EmojiMatch {
    fullMatch: string;
    animated: boolean;
    name: string;
    id: string;
    index: number;
}

/**
 * 絵文字CDN URLを取得
 */
export function getEmojiUrl(id: string, animated: boolean, size: number = 48): string {
    const extension = animated ? 'gif' : 'webp';
    return `https://cdn.discordapp.com/emojis/${id}.${extension}?size=${size}&quality=lossless`;
}

/**
 * テキストからカスタム絵文字を検出
 */
function findEmojis(text: string): EmojiMatch[] {
    const matches: EmojiMatch[] = [];
    let match;

    while ((match = CUSTOM_EMOJI_REGEX.exec(text)) !== null) {
        matches.push({
            fullMatch: match[0],
            animated: match[1] === 'a',
            name: match[2],
            id: match[3],
            index: match.index,
        });
    }

    return matches;
}

/**
 * カスタム絵文字コンポーネント
 */
interface CustomEmojiProps {
    id: string;
    name: string;
    animated: boolean;
    size?: number;
    className?: string;
}

export const CustomEmoji: React.FC<CustomEmojiProps> = ({
    id,
    name,
    animated,
    size = 20,
    className = ''
}) => {
    return (
        <img
            src={getEmojiUrl(id, animated)}
            alt={`:${name}:`}
            title={`:${name}:`}
            width={size}
            height={size}
            loading="lazy"
            decoding="async"
            className={`inline-block align-middle ${className}`}
            style={{ verticalAlign: '-0.2em' }}
            onError={(e) => {
                // 読み込み失敗時はテキスト表示にフォールバック
                const target = e.target as HTMLImageElement;
                target.style.display = 'none';
                target.insertAdjacentText('afterend', `:${name}:`);
            }}
        />
    );
};

/**
 * テキスト内のカスタム絵文字をReact要素に変換
 * @param text 入力テキスト
 * @returns React要素の配列
 */
export function parseEmojis(text: string): React.ReactNode[] {
    const emojis = findEmojis(text);

    if (emojis.length === 0) {
        return [text];
    }

    const result: React.ReactNode[] = [];
    let lastIndex = 0;

    emojis.forEach((emoji, i) => {
        // 絵文字の前のテキスト
        if (emoji.index > lastIndex) {
            result.push(text.slice(lastIndex, emoji.index));
        }

        // 絵文字コンポーネント
        result.push(
            <CustomEmoji
                key={`emoji-${i}-${emoji.id}`}
                id={emoji.id}
                name={emoji.name}
                animated={emoji.animated}
            />
        );

        lastIndex = emoji.index + emoji.fullMatch.length;
    });

    // 残りのテキスト
    if (lastIndex < text.length) {
        result.push(text.slice(lastIndex));
    }

    return result;
}

/**
 * 絵文字のみのメッセージかどうかを判定（大きく表示するため）
 */
export function isEmojiOnlyMessage(text: string): boolean {
    const stripped = text.replace(CUSTOM_EMOJI_REGEX, '').trim();
    return stripped.length === 0;
}
