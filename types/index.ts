export type TicketStatus = 'Open' | 'Closed' | 'In Progress' | 'Backlogged' | 'Awaiting Cost'

export type Department =
  | '🏭 Production Operations'
  | '🦺 HSE'
  | '🛠️ Repair and Maintenance'
  | '⚡ Electrical'
  | '🔁 Automation'
  | '📊 Measurement'
  | '⚙️ Compression'
  | '🧪 Chemical'
  | '📒 Engineering'

export type LocationType = 'Well' | 'Facility' | 'Compressor Station'

export type PriorityOfIssue = 'Low' | 'Medium' | 'High' | 'Urgent / Critical'

export interface MaintenanceFormSubmission {
  id: number
  Department: Department
  Issue_Date: string
  Location_Type: LocationType
  Field: string
  Route: string
  Facility?: string
  Equipment_Type: string
  Equipment: string
  Issue_Description: string
  Troubleshooting_Conducted?: string
  Contacted_Vendor?: string
  Priority_of_Issue?: PriorityOfIssue
  Issue_Photos?: string[]
  Well?: string
  Created_by_Email: string
  Created_by_Name: string
  Ticket_Status: TicketStatus
  Asset: string
  Area: string
  Work_Order_Type?: string
  Self_Dispatch_Assignee?: string
  Estimate_Cost?: number
  assigned_foreman?: string
}

export interface Dispatch {
  id: number
  ticket_id: number
  maintenance_foreman?: string
  date_assigned?: string
  due_date?: string
  created_at: string
  production_foreman?: string
  work_order_decision?: string
  ticket_status?: TicketStatus
  self_dispatch_assignee?: string
  Estimate_Cost?: number
}

export interface RepairsCloseout {
  id: number
  ticket_id: number
  start_date?: string
  repair_details?: string
  repair_images?: string[]
  vendor?: string
  total_repair_cost?: number
  date_completed?: string
  final_status?: string
  date_closed?: string
  closed_by?: string
  created_at: string
  created_by?: string
  updated_at?: string
  Work_Order_Type?: string
  AFE_Number?: string
  Priority_of_Issue?: PriorityOfIssue
}

export interface VendorPaymentDetails {
  id: number
  ticket_id: number
  vendor?: string
  vendor_cost?: number
  vendor_2?: string
  vendor_cost_2?: number
  vendor_3?: string
  vendor_cost_3?: number
  vendor_4?: string
  vendor_cost_4?: number
  vendor_5?: string
  vendor_cost_5?: number
  vendor_6?: string
  vendor_cost_6?: number
  vendor_7?: string
  vendor_cost_7?: number
  total_cost?: number
  created_at: string
  updated_at: string
}

export interface Employee {
  id: number
  name: string
  job_title?: string
  manager?: string
  work_email?: string
  created_at: string
  updated_at: string
}

export interface EquipmentType {
  id: string
  equipment_type: string
  department_owner_id?: string
}

export interface EquipmentLibrary {
  id: number
  match_type: string
  equip_name: string
  equip_code: string
  type: string
}

export interface WellFacilityRow {
  UNITID: string
  ROUTENAME: string
  Asset: string
  Area: string
  FIELD: string
  WELLNAME: string
  Facility_Name: string
}

export interface TicketListItem {
  id: number
  Asset: string
  Facility?: string
  Well?: string
  Equipment: string
  Ticket_Status: TicketStatus
  Issue_Date: string
  Issue_Photos?: string[]
  Department: Department
  assigned_foreman?: string
  Created_by_Name: string
}

export interface TicketSummary extends MaintenanceFormSubmission {
  work_order_decision?: string
  production_foreman?: string
  maintenance_foreman?: string
  date_assigned?: string
  due_date?: string
  is_creator?: boolean
  is_assignee?: boolean
  latest_dispatch_created_at?: string
  latest_closeout_ts?: string
  last_activity_ts?: string
}

export interface Comment {
  id: number
  ticket_id: number
  tab: 'dispatch' | 'repairs'
  content: string
  created_by: string
  created_at: string
}
