export interface ServiceItem {
    key?: string;
    name: string;
    desc: string;
    url: string;
    icon: string;
    color: string;
    state?: string;
    hidden?: boolean;
    bot?: boolean;
}

export interface Section {
    id: string;
    label: string;
    icon: string;
    items: ServiceItem[];
    adminOnly?: boolean;
    hidden?: boolean;
}

export interface Container {
    id: string;
    name: string;
    state: string;
    status: string;
}

export interface ContainerGroup {
    label: string;
    containers: Container[];
}

export interface ContainerDetail {
    cpu: number;
    memory: { used: number; limit: number };
    state: string;
    startedAt: string;
}

export interface ServerStats {
    cpu: number;
    memory: { total: number; used: number; percent: number };
    disk: { total: number; used: number; percent: number };
    uptime: number;
    load: { load1: number; load5: number; load15: number };
}

// --- Vitrine (lucipher-lab.fr), voir server/vitrine.cjs ---

export interface VitrineLink { label: string; href: string; }

export interface VitrineItem {
    id: string;
    name: string;
    desc: string;
    url: string;
    visible: boolean;
    // royaumes uniquement
    subtitle?: string;
    icon?: string;
    open?: boolean;
    label?: string;
}

export type VitrineBlockType = 'realms' | 'tools' | 'text' | 'contact';

export interface VitrineBlock {
    id: string;
    type: VitrineBlockType;
    visible: boolean;
    kicker: string;
    title: string;
    text: string;
    email?: string;
    items?: VitrineItem[];
}

export interface Vitrine {
    hero: {
        visible: boolean;
        showGate: boolean;
        title: string;
        tagline: string;
        lead: string;
        primary: VitrineLink;
        secondary: VitrineLink;
    };
    blocks: VitrineBlock[];
}

export interface HealthCheck {
    key: string;
    name: string;
    url: string;
    status: number;
    ms: number;
    error?: string;
}
