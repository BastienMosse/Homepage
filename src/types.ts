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

// --- Consommation par service (server/resources.cjs) ---

export interface ResourceUsage {
    cpu: number; cpu1h: number; cpuMax24h: number;   // % de la machine entière
    mem: number; memMax24h: number;                 // octets
    rx: number; tx: number; rd: number; wr: number; // octets/s
    sparkCpu: (number | null)[];
    sparkMem: (number | null)[];
}

export interface ResourceItem extends Container, ResourceUsage {
    docker: string;
    image: string;
    pids: number;
    mem1h: number;
    protected: string;
}

export interface ResourceGroup extends ResourceUsage {
    key: string;
    label: string;
    kind: 'app' | 'service' | 'system' | 'other';
    running: number;
    containers: ResourceItem[];
}

export interface ResourcesOverview {
    at: number;
    interval: number;
    historySince: number;
    host: { cpus: number; cpu: number; memTotal: number; memUsed: number; otherCpu: number; otherMem: number };
    groups: ResourceGroup[];
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
    icon?: string;
    // Portail (portes) uniquement
    subtitle?: string;
    open?: boolean;
    label?: string;
}

// realms = le Portail (portes des royaumes) ; classic = titre + texte + services
export type VitrineBlockType = 'realms' | 'classic';

export interface VitrineBlock {
    id: string;
    type: VitrineBlockType;
    visible: boolean;
    kicker: string;
    title: string;
    text: string;
    items: VitrineItem[];
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
    footer: {
        visible: boolean;
        text: string;
        // Un lien sans href s'affiche en simple texte
        links: VitrineLink[];
    };
}

export interface HealthCheck {
    key: string;
    name: string;
    url: string;
    status: number;
    ms: number;
    error?: string;
}

// --- Hermod : envois de mails programmés (server/hermod.cjs) ---

export type HermodStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'cancelled';

export interface HermodField { label: string; type: 'text' | 'whisper'; scope?: 'common' | 'recipient'; }

export interface HermodTemplate {
    id: string;
    name: string;
    subject: string;
    html: string;
    fields: Record<string, HermodField>;
    vars: string[];
    updatedAt: number;
}

export interface HermodJob {
    id: string;
    status: HermodStatus;
    createdAt: number;
    sendAt: number;
    duration: string;
    from: string;
    fromName?: string;
    templateId?: string;
    templateName?: string;
    subject?: string;
    to: string;
    values?: Record<string, string>;
    secretFields?: string[];
    batch?: string;
    hasSecrets: boolean;
    sentAt?: number;
    whisperExpiresAt?: number;
    sentFolder?: string;
    attempts?: number;
    error?: string;
    warning?: string;
}

export interface HermodInfo {
    senders: string[];
    fromName: string;
    durations: Record<string, string>;
    autoVars: Record<string, string>;
    jobs: HermodJob[];
    templates: HermodTemplate[];
}
