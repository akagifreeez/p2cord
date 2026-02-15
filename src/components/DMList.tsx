import React from 'react';

export interface DMChannel {
    id: string;
    name: string; // Recipient names or custom name
    kind: string; // "DM" or "GroupDM"
    last_message_id?: string;
}

interface DMListProps {
    dms: DMChannel[];
    selectedDmId: string | null;
    onSelectDm: (id: string) => void;
}

export const DMList: React.FC<DMListProps> = ({ dms, selectedDmId, onSelectDm }) => {
    return (
        <div className="flex-1 overflow-y-auto bg-gray-900">
            <div className="px-3 pt-4 pb-2 text-xs font-bold text-gray-400 uppercase tracking-wide">
                Direct Messages
            </div>
            <div className="px-2 space-y-0.5">
                {dms.map(dm => {
                    const isSelected = dm.id === selectedDmId;
                    return (
                        <div
                            key={dm.id}
                            onClick={() => onSelectDm(dm.id)}
                            className={`
                                group px-2 py-2 flex items-center gap-3 rounded cursor-pointer transition-colors
                                ${isSelected ? 'bg-gray-700 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'}
                            `}
                        >
                            <div className="relative">
                                {/* Initial Icon */}
                                <div className="w-8 h-8 rounded-full bg-gray-600 flex items-center justify-center text-sm font-medium text-white shrink-0">
                                    {dm.name ? dm.name.substring(0, 1).toUpperCase() : '?'}
                                </div>
                                {/* Status Indicator (Mock for now, could be real if extended) */}
                                {/* <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-gray-900 rounded-full"></div> */}
                            </div>

                            <div className="flex-1 min-w-0">
                                <div className={`text-sm font-medium truncate ${isSelected ? 'text-white' : 'text-gray-300 group-hover:text-gray-100'}`}>
                                    {dm.name || "Unknown User"}
                                </div>
                                {/* Last message preview could go here */}
                            </div>
                        </div>
                    );
                })}

                {dms.length === 0 && (
                    <div className="px-4 py-8 text-center text-gray-500 text-sm">
                        No Direct Messages found.
                    </div>
                )}
            </div>
        </div>
    );
};
