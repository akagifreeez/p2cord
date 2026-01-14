
import React, { useMemo } from 'react';

export interface SimpleRole {
    id: string;
    name: string;
    color: number;
    position: number;
    hoist: boolean;
}

export interface SimpleMember {
    user: {
        id: string;
        username: string;
        discriminator: string;
        avatar?: string | null;
    };
    roles: string[];
    nick?: string | null;
    joined_at: string;
}

// Gateway経由で取得するプレゼンス付きメンバー
export interface MemberWithPresence {
    user: {
        id: string;
        username: string;
        discriminator: string;
        avatar?: string | null;
    };
    roles: string[];
    nick?: string | null;
    joined_at: string;
    status: string;  // "online", "idle", "dnd", "offline"
    activities: Activity[];
    client_status: ClientStatus;
}

export interface Activity {
    name: string;
    activity_type: number;
    state?: string;
    details?: string;
}

export interface ClientStatus {
    desktop?: string;
    mobile?: string;
    web?: string;
}

interface MemberSidebarProps {
    members: SimpleMember[] | MemberWithPresence[];
    roles: SimpleRole[];
    loading?: boolean;
}

export const MemberSidebar: React.FC<MemberSidebarProps> = ({ members, roles, loading }) => {
    // Group members by hoisted roles
    const groupedMembers = useMemo(() => {
        if (!members || !roles) return [];

        // Sort roles by position (descending)
        const sortedRoles = [...roles].sort((a, b) => b.position - a.position);

        // Helper to get color for a member (from their highest colored role)
        const getMemberColor = (member: SimpleMember) => {
            const memberRoles = member.roles
                .map(rId => roles.find(r => r.id === rId))
                .filter((r): r is SimpleRole => !!r)
                .sort((a, b) => b.position - a.position);

            const coloredRole = memberRoles.find(r => r.color !== 0);
            return coloredRole ? `#${coloredRole.color.toString(16).padStart(6, '0')}` : undefined;
        };

        // Initialize groups for Hoisted roles
        const groups: { role: SimpleRole, members: SimpleMember[] }[] = sortedRoles
            .filter(r => r.hoist)
            .map(r => ({ role: r, members: [] }));

        // "Online" or "Everyone" group for those who don't match any hoisted role (or just fallback)
        // Discord uses "Online", "Offline" etc. based on status, but here we group by role first.
        // If a member has multiple hoisted roles, they appear in the highest one.

        // "Online" or "Everyone" group for those who don't match any hoisted role (or just fallback)
        const everyoneGroup: { role: SimpleRole, members: SimpleMember[] } = {
            role: { id: 'everyone', name: 'Online', color: 0, position: -1, hoist: true },
            members: []
        };

        const assignedMemberIds = new Set<string>();

        // Iterate through sorted hoisted roles and assign members
        for (const group of groups) {
            const roleId = group.role.id;
            // Find members who have this role AND are not yet assigned to a higher group
            const eligibleMembers = members.filter(m =>
                m.roles.includes(roleId) && !assignedMemberIds.has(m.user.id)
            );

            // Sort alphabetically or by nick
            eligibleMembers.sort((a, b) => (a.nick || a.user.username).localeCompare(b.nick || b.user.username));

            group.members = eligibleMembers;
            eligibleMembers.forEach(m => assignedMemberIds.add(m.user.id));
        }

        // Remaining members go to "Everyone" (or Online)
        const remaining = members.filter(m => !assignedMemberIds.has(m.user.id));
        remaining.sort((a, b) => (a.nick || a.user.username).localeCompare(b.nick || b.user.username));
        everyoneGroup.members = remaining;

        // Filter out empty groups
        const result = [...groups, everyoneGroup].filter(g => g.members.length > 0);

        // Attach color info to member objects for rendering (temporary)
        return result.map(g => ({
            ...g,
            members: g.members.map(m => ({ ...m, displayColor: getMemberColor(m) }))
        }));

    }, [members, roles]);

    if (loading) {
        return (
            <div className="w-60 bg-[#1e1f22] border-l border-[#111] p-4 flex flex-col gap-2">
                <div className="animate-pulse h-4 bg-gray-700 rounded w-1/2 mb-4"></div>
                {[1, 2, 3, 4, 5].map(i => (
                    <div key={i} className="flex items-center gap-3 animate-pulse">
                        <div className="w-8 h-8 bg-gray-700 rounded-full"></div>
                        <div className="h-3 bg-gray-700 rounded w-2/3"></div>
                    </div>
                ))}
            </div>
        );
    }

    // メンバーリストが空の場合（API制限による）
    if (members.length === 0) {
        return (
            <div className="w-60 bg-[#1e1f22] border-l border-[#111] p-4 flex flex-col">
                <div className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">
                    Members
                </div>
                <div className="text-xs text-gray-500 leading-relaxed">
                    メンバーリストはユーザートークンでは取得できません。
                    <br /><br />
                    将来的にGateway経由で実装予定です。
                </div>
                {/* ロールのみ表示 */}
                {roles.filter(r => r.hoist && r.name !== '@everyone').length > 0 && (
                    <div className="mt-4 border-t border-gray-700 pt-3">
                        <div className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">
                            Roles ({roles.filter(r => r.hoist).length})
                        </div>
                        {roles.filter(r => r.hoist && r.name !== '@everyone').sort((a, b) => b.position - a.position).map(role => (
                            <div key={role.id} className="text-xs px-2 py-1 flex items-center gap-2">
                                <div
                                    className="w-3 h-3 rounded-full"
                                    style={{ backgroundColor: role.color ? `#${role.color.toString(16).padStart(6, '0')}` : '#99aab5' }}
                                />
                                <span className="text-gray-300">{role.name}</span>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        );
    }

    return (
        <div className="w-60 bg-[#1e1f22] border-l border-[#111] overflow-y-auto flex flex-col select-none">
            {groupedMembers.map(group => (
                <div key={group.role.id} className="py-2">
                    <div className="px-4 pb-1 text-xs font-bold text-gray-400 uppercase tracking-wide truncate">
                        {group.role.name} — {group.members.length}
                    </div>
                    <div>
                        {group.members.map(member => (
                            <div
                                key={member.user.id}
                                className="mx-2 px-2 py-1.5 flex items-center gap-2 rounded hover:bg-gray-700/50 cursor-pointer group transition-colors opacity-90 hover:opacity-100"
                            >
                                <div className="relative flex-shrink-0">
                                    {member.user.avatar ? (
                                        <img
                                            src={`https://cdn.discordapp.com/avatars/${member.user.id}/${member.user.avatar}.png?size=64`}
                                            alt={member.user.username}
                                            className="w-8 h-8 rounded-full bg-gray-800 object-cover"
                                        />
                                    ) : (
                                        <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center text-xs text-white">
                                            {(member.nick || member.user.username)[0].toUpperCase()}
                                        </div>
                                    )}
                                    {/* Status Indicator */}
                                    <div className={`absolute bottom-0 right-0 w-3 h-3 border-2 border-[#1e1f22] rounded-full ${(member as any).status === 'online' ? 'bg-green-500' :
                                        (member as any).status === 'idle' ? 'bg-yellow-500' :
                                            (member as any).status === 'dnd' ? 'bg-red-500' :
                                                'bg-gray-500'
                                        }`}></div>
                                </div>
                                <div className="min-w-0 flex-1">
                                    <div
                                        className="text-sm font-medium truncate"
                                        style={{ color: (member as any).displayColor || '#9ca3af' }}
                                    >
                                        {member.nick || member.user.username}
                                    </div>
                                    {/* Activity Display */}
                                    {(member as any).activities?.length > 0 && (
                                        <div className="text-xs text-gray-500 truncate">
                                            {(member as any).activities[0].activity_type === 0 && 'Playing '}
                                            {(member as any).activities[0].activity_type === 2 && 'Listening to '}
                                            {(member as any).activities[0].activity_type === 4 && ''}
                                            {(member as any).activities[0].name}
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
};
