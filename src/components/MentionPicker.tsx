import React, { useState, useEffect, useRef, useCallback } from 'react';

/**
 * メンションピッカー
 * @入力でユーザー/ロール/チャンネルの候補を表示
 */

export interface MentionSuggestion {
    type: 'user' | 'role' | 'channel';
    id: string;
    name: string;
    displayName?: string; // ニックネーム等
    color?: string; // ロールカラー
}

interface MentionPickerProps {
    suggestions: MentionSuggestion[];
    isOpen: boolean;
    position: { top: number; left: number };
    selectedIndex: number;
    onSelect: (suggestion: MentionSuggestion) => void;
    onClose: () => void;
}

export const MentionPicker: React.FC<MentionPickerProps> = ({
    suggestions,
    isOpen,
    position,
    selectedIndex,
    onSelect,
    onClose: _onClose,
}) => {
    const listRef = useRef<HTMLDivElement>(null);

    // 選択中アイテムをスクロール表示
    useEffect(() => {
        if (listRef.current && selectedIndex >= 0) {
            const item = listRef.current.children[selectedIndex] as HTMLElement;
            if (item) {
                item.scrollIntoView({ block: 'nearest' });
            }
        }
    }, [selectedIndex]);

    if (!isOpen || suggestions.length === 0) return null;

    return (
        <div
            className="absolute z-50 bg-gray-900 border border-gray-700 rounded-lg shadow-xl overflow-hidden"
            style={{
                bottom: position.top,
                left: position.left,
                minWidth: '200px',
                maxWidth: '300px',
                maxHeight: '200px',
            }}
        >
            <div ref={listRef} className="overflow-y-auto max-h-[200px]">
                {suggestions.map((suggestion, index) => (
                    <div
                        key={`${suggestion.type}-${suggestion.id}`}
                        className={`px-3 py-2 cursor-pointer flex items-center gap-2 transition-colors ${index === selectedIndex
                            ? 'bg-blue-600 text-white'
                            : 'hover:bg-gray-800 text-gray-300'
                            }`}
                        onClick={() => onSelect(suggestion)}
                        onMouseEnter={() => { }}
                    >
                        {/* アイコン */}
                        <span className="text-sm">
                            {suggestion.type === 'user' && '👤'}
                            {suggestion.type === 'role' && '🏷️'}
                            {suggestion.type === 'channel' && '#'}
                        </span>

                        {/* 名前 */}
                        <span
                            className="flex-1 truncate font-medium"
                            style={suggestion.color ? { color: suggestion.color } : undefined}
                        >
                            {suggestion.displayName || suggestion.name}
                        </span>

                        {/* ユーザー名（ニックネームがある場合） */}
                        {suggestion.displayName && suggestion.displayName !== suggestion.name && (
                            <span className="text-xs text-gray-500">
                                {suggestion.name}
                            </span>
                        )}
                    </div>
                ))}
            </div>

            {/* ヒント */}
            <div className="px-3 py-1.5 text-xs text-gray-500 border-t border-gray-700 bg-gray-900/50">
                ↑↓で選択 • Enterで確定 • Escで閉じる
            </div>
        </div>
    );
};

/**
 * メンションピッカー用フック
 */
export interface UseMentionPickerOptions {
    users?: Array<{ id: string; name: string; nick?: string }>;
    roles?: Array<{ id: string; name: string; color?: string }>;
    channels?: Array<{ id: string; name: string }>;
}

export function useMentionPicker(options: UseMentionPickerOptions) {
    const [isOpen, setIsOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [triggerPosition, setTriggerPosition] = useState({ top: 40, left: 0 });
    const [triggerIndex, setTriggerIndex] = useState(-1); // @の位置

    // 候補をフィルタリング
    const suggestions: MentionSuggestion[] = React.useMemo(() => {
        if (!isOpen) return [];

        const lowerQuery = query.toLowerCase();
        const result: MentionSuggestion[] = [];

        // ユーザー
        options.users?.forEach(user => {
            if (query.length === 0 ||
                user.name.toLowerCase().includes(lowerQuery) ||
                user.nick?.toLowerCase().includes(lowerQuery)) {
                result.push({
                    type: 'user',
                    id: user.id,
                    name: user.name,
                    displayName: user.nick || user.name,
                });
            }
        });

        // ロール
        options.roles?.forEach(role => {
            if (query.length === 0 || role.name.toLowerCase().includes(lowerQuery)) {
                result.push({
                    type: 'role',
                    id: role.id,
                    name: role.name,
                    color: role.color,
                });
            }
        });

        // チャンネル（@でもチャンネルを表示可能に）
        options.channels?.forEach(channel => {
            if (query.length === 0 || channel.name.toLowerCase().includes(lowerQuery)) {
                result.push({
                    type: 'channel',
                    id: channel.id,
                    name: channel.name,
                });
            }
        });

        return result.slice(0, 10); // 最大10件
    }, [isOpen, query, options.users, options.roles, options.channels]);

    // 入力処理
    const handleInputChange = useCallback((
        value: string,
        cursorPosition: number,
        _inputElement: HTMLTextAreaElement | HTMLInputElement
    ) => {
        // @の検索（カーソル位置より前）
        const beforeCursor = value.slice(0, cursorPosition);
        const atMatch = beforeCursor.match(/@(\w*)$/);

        if (atMatch) {
            setIsOpen(true);
            setQuery(atMatch[1]);
            setTriggerIndex(atMatch.index!);
            setSelectedIndex(0);

            // 入力ボックスの位置から計算（将来的に動的配置用）
            setTriggerPosition({ top: 40, left: 0 });
        } else {
            setIsOpen(false);
            setQuery('');
            setTriggerIndex(-1);
        }
    }, []);

    // キーボード操作
    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (!isOpen) return false;

        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                setSelectedIndex(prev =>
                    prev < suggestions.length - 1 ? prev + 1 : 0
                );
                return true;

            case 'ArrowUp':
                e.preventDefault();
                setSelectedIndex(prev =>
                    prev > 0 ? prev - 1 : suggestions.length - 1
                );
                return true;

            case 'Enter':
            case 'Tab':
                if (suggestions[selectedIndex]) {
                    e.preventDefault();
                    return { selected: suggestions[selectedIndex] };
                }
                return false;

            case 'Escape':
                e.preventDefault();
                setIsOpen(false);
                return true;
        }
        return false;
    }, [isOpen, suggestions, selectedIndex]);

    // メンション挿入テキストを生成
    const getMentionText = useCallback((suggestion: MentionSuggestion): string => {
        switch (suggestion.type) {
            case 'user':
                return `<@${suggestion.id}>`;
            case 'role':
                return `<@&${suggestion.id}>`;
            case 'channel':
                return `<#${suggestion.id}>`;
        }
    }, []);

    // 選択時のテキスト置換
    const replaceWithMention = useCallback((
        value: string,
        suggestion: MentionSuggestion
    ): { newValue: string; newCursor: number } => {
        if (triggerIndex < 0) return { newValue: value, newCursor: value.length };

        const before = value.slice(0, triggerIndex);
        const afterAtAndQuery = value.slice(triggerIndex).replace(/^@\w*/, '');
        const mentionText = getMentionText(suggestion) + ' ';

        return {
            newValue: before + mentionText + afterAtAndQuery,
            newCursor: before.length + mentionText.length,
        };
    }, [triggerIndex, getMentionText]);

    const close = useCallback(() => {
        setIsOpen(false);
        setQuery('');
        setTriggerIndex(-1);
    }, []);

    return {
        isOpen,
        suggestions,
        selectedIndex,
        position: triggerPosition,
        handleInputChange,
        handleKeyDown,
        replaceWithMention,
        close,
        setSelectedIndex,
    };
}
