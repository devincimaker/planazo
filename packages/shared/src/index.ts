// App constants
export const APP_NAME = 'Planazo';

// Brand colors
export const COLORS = {
  orange: '#f8730e',
  pink: '#f7b0dc',
  red: '#ed3902',
  white: '#ffffff',
  black: '#000000',
  gray: {
    50: '#f9fafb',
    100: '#f3f4f6',
    200: '#e5e7eb',
    300: '#d1d5db',
    400: '#9ca3af',
    500: '#6b7280',
    600: '#4b5563',
    700: '#374151',
    800: '#1f2937',
    900: '#111827',
  },
} as const;

// User types
export interface Profile {
  id: string;
  email: string;
  display_name: string;
  avatar_url: string | null;
  push_token: string | null;
  created_at: string;
  updated_at: string;
}

// Group types
export type GroupRole = 'admin' | 'member';

export interface Group {
  id: string;
  name: string;
  description: string | null;
  invite_code: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface GroupMember {
  id: string;
  group_id: string;
  user_id: string;
  role: GroupRole;
  joined_at: string;
}

export interface GroupWithMemberCount extends Group {
  member_count: number;
}

export interface GroupMemberWithProfile extends GroupMember {
  profile: Profile;
}

// Plan types
export type PlanType = 'fixed' | 'flexible';
export type PlanStatus = 'open' | 'locked' | 'cancelled';

export interface Plan {
  id: string;
  group_id: string | null; // null for groupless plans
  created_by: string;
  title: string;
  description: string | null;
  location: string | null;
  plan_type: PlanType;
  event_date: string | null; // ISO string, only for fixed plans
  min_people: number;
  max_people: number | null;
  status: PlanStatus;
  locked_date: string | null; // ISO string, for flexible plans when locked
  locked_at: string | null;
  deadline: string | null; // ISO string
  created_at: string;
  updated_at: string;
}

export interface PlanDateOption {
  id: string;
  plan_id: string;
  date: string; // ISO string
  created_at: string;
}

// RSVP types
export type RsvpResponse = 'yes' | 'no' | 'pending';

export interface Rsvp {
  id: string;
  plan_id: string;
  user_id: string;
  response: RsvpResponse | null;
  created_at: string;
  updated_at: string;
}

export interface RsvpWithProfile extends Rsvp {
  profile: Profile;
}

export interface DateAvailability {
  id: string;
  plan_id: string;
  user_id: string;
  date_option_id: string;
  available: boolean;
  created_at: string;
}

export interface DateAvailabilityWithProfile extends DateAvailability {
  profile: Profile;
}

export interface DateOptionWithAvailability extends PlanDateOption {
  availabilities: DateAvailabilityWithProfile[];
  available_count: number;
}

// Notification types
export type NotificationType =
  | 'plan_created'
  | 'plan_locked'
  | 'plan_cancelled'
  | 'invited_to_group'
  | 'kicked_from_group'
  | 'friend_request'
  | 'friend_accepted'
  | 'plan_invite';

export interface Notification {
  id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  body: string;
  data: Record<string, string> | null;
  read: boolean;
  created_at: string;
}

// Group invite types
export type InviteStatus = 'pending' | 'accepted' | 'declined';

export interface GroupInvite {
  id: string;
  group_id: string;
  invited_by: string;
  invited_email: string | null;
  invite_code: string | null;
  status: InviteStatus;
  created_at: string;
  expires_at: string;
}

// Friendship types
export type FriendshipStatus = 'pending' | 'accepted';

export interface Friendship {
  id: string;
  requester_id: string;
  addressee_id: string;
  status: FriendshipStatus;
  created_at: string;
  accepted_at: string | null;
}

export interface FriendshipWithProfiles extends Friendship {
  requester: Profile;
  addressee: Profile;
}

export interface FriendWithProfile {
  friendship: Friendship;
  friend: Profile;
}

// Plan invite types (for groupless plans)
export interface PlanInvite {
  id: string;
  plan_id: string;
  user_id: string;
  invited_by: string;
  created_at: string;
}

export interface PlanInviteWithProfile extends PlanInvite {
  profile: Profile;
}

// Extended types for UI
export interface PlanWithDetails extends Plan {
  creator: Profile;
  rsvp_count: number;
  user_rsvp?: Rsvp;
  date_options?: DateOptionWithAvailability[];
}

export interface GroupWithDetails extends Group {
  member_count: number;
  members?: GroupMemberWithProfile[];
  plans?: Plan[];
}

// API request/response types
export interface CreateGroupRequest {
  name: string;
  description?: string;
}

export interface JoinGroupRequest {
  invite_code: string;
}

export interface CreatePlanRequest {
  group_id?: string; // optional for groupless plans
  title: string;
  description?: string;
  location?: string;
  plan_type: PlanType;
  event_date?: string; // For fixed plans
  date_options?: string[]; // For flexible plans - array of ISO date strings
  min_people: number;
  max_people?: number;
  deadline?: string;
}

export interface UpdateRsvpRequest {
  response: RsvpResponse;
}

export interface UpdateAvailabilityRequest {
  date_option_id: string;
  available: boolean;
}

// Friends API types
export interface SendFriendRequestRequest {
  addressee_id: string;
}

export interface FriendsResponse {
  friends: FriendWithProfile[];
  pendingReceived: FriendshipWithProfiles[];
  pendingSent: FriendshipWithProfiles[];
}

// Groupless plan types
export interface CreateGrouplessPlanRequest {
  title: string;
  description?: string;
  location?: string;
  plan_type: PlanType;
  event_date?: string;
  date_options?: string[];
  min_people: number;
  max_people?: number;
  deadline?: string;
  invite_friend_ids: string[];
}

export interface GrouplessPlanWithDetails extends Plan {
  creator: Profile;
  invites: PlanInviteWithProfile[];
  rsvp_count: number;
  user_rsvp?: Rsvp;
  date_options?: DateOptionWithAvailability[];
}
