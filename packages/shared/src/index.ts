export interface User {
  id: string;
  email: string;
  name: string;
}

export interface Plan {
  id: string;
  title: string;
  description: string;
  createdBy: string;
  participants: string[];
  createdAt: Date;
}

export const APP_NAME = 'Planazo';
