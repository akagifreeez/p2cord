import React from 'react';
import { open } from '@tauri-apps/plugin-shell';

export const linkify = (text: string): React.ReactNode[] => {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const parts = text.split(urlRegex);

    return parts.map((part, index) => {
        if (part.match(urlRegex)) {
            return React.createElement('a', {
                key: index,
                href: part,
                target: '_blank',
                rel: 'noopener noreferrer',
                className: 'text-blue-400 hover:underline break-all',
                onClick: async (e: React.MouseEvent) => {
                    e.preventDefault();
                    e.stopPropagation();
                    try {
                        await open(part);
                    } catch (err) {
                        console.error('Failed to open URL:', err);
                    }
                }
            }, part);
        }
        return part;
    });
};
