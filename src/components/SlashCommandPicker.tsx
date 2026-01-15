import React, { useState, useCallback, useMemo } from 'react';

/**
 * スラッシュコマンドピッカー
 * /入力でコマンド一覧を表示（ビルトイン + BOTコマンド）
 */

// ビルトインコマンド
export interface SlashCommand {
    type: 'builtin';
    name: string;
    description: string;
    args?: string;
    execute: (args: string) => string;
}

// BOTコマンド（Discord Application Command）
export interface BotCommand {
    type: 'bot';
    id: string;
    application_id: string;
    name: string;
    description: string;
    options: CommandOption[];
}

export interface CommandOption {
    name: string;
    option_type: number;
    description: string;
    required: boolean;
    choices: Array<{ name: string; value: string | number }>;
    options: CommandOption[];
}

export type AnyCommand = SlashCommand | BotCommand;

// 組み込みコマンド定義
export const BUILT_IN_COMMANDS: SlashCommand[] = [
    {
        type: 'builtin',
        name: 'shrug',
        description: '¯\\_(ツ)_/¯ を送信',
        execute: (args) => `¯\\_(ツ)_/¯ ${args}`.trim(),
    },
    {
        type: 'builtin',
        name: 'tableflip',
        description: '(╯°□°)╯︵ ┻━┻ を送信',
        execute: (args) => `(╯°□°)╯︵ ┻━┻ ${args}`.trim(),
    },
    {
        type: 'builtin',
        name: 'unflip',
        description: '┬─┬ノ( º _ ºノ) を送信',
        execute: (args) => `┬─┬ノ( º _ ºノ) ${args}`.trim(),
    },
    {
        type: 'builtin',
        name: 'me',
        description: 'アクション形式で送信',
        args: '[アクション]',
        execute: (args) => `*${args}*`,
    },
    {
        type: 'builtin',
        name: 'spoiler',
        description: 'スポイラーテキストを送信',
        args: '[テキスト]',
        execute: (args) => `||${args}||`,
    },
    {
        type: 'builtin',
        name: 'lenny',
        description: '( ͡° ͜ʖ ͡°) を送信',
        execute: (args) => `( ͡° ͜ʖ ͡°) ${args}`.trim(),
    },
];

interface SlashCommandPickerProps {
    commands: AnyCommand[];
    isOpen: boolean;
    position: { top: number; left: number };
    selectedIndex: number;
    onSelect: (command: AnyCommand) => void;
    onClose: () => void;
}

export const SlashCommandPicker: React.FC<SlashCommandPickerProps> = ({
    commands,
    isOpen,
    position,
    selectedIndex,
    onSelect,
    onClose: _onClose,
}) => {
    if (!isOpen || commands.length === 0) return null;

    return (
        <div
            className="absolute z-50 bg-gray-900 border border-gray-700 rounded-lg shadow-xl overflow-hidden"
            style={{
                bottom: position.top,
                left: position.left,
                minWidth: '250px',
                maxWidth: '400px',
                maxHeight: '250px',
            }}
        >
            <div className="px-3 py-2 border-b border-gray-700 text-xs text-gray-400 font-bold uppercase">
                コマンド
            </div>
            <div className="overflow-y-auto max-h-[200px]">
                {commands.map((cmd, index) => (
                    <div
                        key={cmd.name}
                        className={`px-3 py-2 cursor-pointer transition-colors ${index === selectedIndex
                            ? 'bg-blue-600 text-white'
                            : 'hover:bg-gray-800 text-gray-300'
                            }`}
                        onClick={() => onSelect(cmd)}
                    >
                        <div className="flex items-center gap-2">
                            {/* BOTコマンドにはアイコン表示 */}
                            {cmd.type === 'bot' && <span className="text-xs text-purple-400">🤖</span>}
                            <span className="font-mono text-cyan-400">/{cmd.name}</span>
                            {cmd.type === 'builtin' && cmd.args && (
                                <span className="text-xs text-gray-500">{cmd.args}</span>
                            )}
                            {cmd.type === 'bot' && cmd.options.length > 0 && (
                                <span className="text-xs text-gray-500">[{cmd.options.length}個の引数]</span>
                            )}
                        </div>
                        <div className="text-xs text-gray-400 mt-0.5">
                            {cmd.description}
                        </div>
                    </div>
                ))}
            </div>
            <div className="px-3 py-1.5 text-xs text-gray-500 border-t border-gray-700 bg-gray-900/50">
                ↑↓で選択 • Enterで確定 • Escで閉じる
            </div>
        </div>
    );
};

/**
 * スラッシュコマンドピッカー用フック
 */
export function useSlashCommandPicker(customCommands: AnyCommand[] = []) {
    const [isOpen, setIsOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [triggerIndex, setTriggerIndex] = useState(-1);

    const allCommands: AnyCommand[] = useMemo(() => [
        ...BUILT_IN_COMMANDS,
        ...customCommands,
    ], [customCommands]);

    // コマンドをフィルタリング
    const filteredCommands = useMemo(() => {
        if (!isOpen) return [];

        const lowerQuery = query.toLowerCase();
        return allCommands.filter(cmd =>
            query.length === 0 || cmd.name.toLowerCase().includes(lowerQuery)
        );
    }, [isOpen, query, allCommands]);

    // 入力処理
    const handleInputChange = useCallback((
        value: string,
        cursorPosition: number
    ) => {
        // /の検索（行頭または空白後）
        const beforeCursor = value.slice(0, cursorPosition);
        const slashMatch = beforeCursor.match(/(?:^|\s)\/(\w*)$/);

        if (slashMatch) {
            setIsOpen(true);
            setQuery(slashMatch[1]);
            setTriggerIndex(beforeCursor.lastIndexOf('/'));
            setSelectedIndex(0);
        } else {
            setIsOpen(false);
            setQuery('');
            setTriggerIndex(-1);
        }
    }, []);

    // キーボード操作
    const handleKeyDown = useCallback((e: React.KeyboardEvent): boolean | { selected: AnyCommand } => {
        if (!isOpen) return false;

        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                setSelectedIndex(prev =>
                    prev < filteredCommands.length - 1 ? prev + 1 : 0
                );
                return true;

            case 'ArrowUp':
                e.preventDefault();
                setSelectedIndex(prev =>
                    prev > 0 ? prev - 1 : filteredCommands.length - 1
                );
                return true;

            case 'Enter':
            case 'Tab':
                if (filteredCommands[selectedIndex]) {
                    e.preventDefault();
                    return { selected: filteredCommands[selectedIndex] };
                }
                return false;

            case 'Escape':
                e.preventDefault();
                setIsOpen(false);
                return true;
        }
        return false;
    }, [isOpen, filteredCommands, selectedIndex]);

    // コマンドを実行して送信テキストを取得（ビルトインのみ）
    // BOTコマンドはChannelChat側でsend_interactionを呼ぶ
    const executeCommand = useCallback((
        value: string,
        command: AnyCommand
    ): { newValue: string; shouldSend: boolean; isBotCommand: boolean; botCommand?: BotCommand } => {
        if (triggerIndex < 0) return { newValue: value, shouldSend: false, isBotCommand: false };

        // /コマンド部分を除去して引数を取得
        const before = value.slice(0, triggerIndex);
        const afterSlash = value.slice(triggerIndex);
        const argsMatch = afterSlash.match(/^\/\w*\s*(.*)$/);
        const _args = argsMatch ? argsMatch[1] : '';

        if (command.type === 'bot') {
            // BOTコマンドは別処理（ChannelChatでsend_interaction）
            return {
                newValue: before,
                shouldSend: false,
                isBotCommand: true,
                botCommand: command,
            };
        }

        // ビルトインコマンド実行
        const result = command.execute(_args);

        return {
            newValue: before + result,
            shouldSend: true, // 即送信
            isBotCommand: false,
        };
    }, [triggerIndex]);

    const close = useCallback(() => {
        setIsOpen(false);
        setQuery('');
        setTriggerIndex(-1);
    }, []);

    return {
        isOpen,
        commands: filteredCommands,
        selectedIndex,
        position: { top: 40, left: 0 },
        handleInputChange,
        handleKeyDown,
        executeCommand,
        close,
        setSelectedIndex,
    };
}
