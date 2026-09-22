export interface Service {
    name: string;
    desc: string;
    url: string;
    icon: string;
    color: string;
}

export interface ApiResponse {
    services: Service[];
    admin?: Service[];
    vpn: boolean;
}
