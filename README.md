# Therapy Care Platform

Build a production-ready therapy centre management platform from scratch.



PRODUCT NAME



The application name must be:



Therapy Care



Do NOT use:



- Therapy Centre OS

- Therapy Centre

- Any previous project name



Use Therapy Care consistently across:



- Login

- Registration

- Dashboard

- Sidebar

- Header

- Page titles

- Browser/app branding

- Empty states

- Notifications

- Settings



---



1. PRODUCT PURPOSE



Therapy Care is a multi-tenant therapy centre management system for therapy-centre owners, administrators and operational staff.



The goal is to replace:



- spreadsheets

- manual appointment notebooks

- scattered child records

- manual therapist scheduling

- payment tracking

- WhatsApp coordination

- disconnected operational records



with one simple clinic operating system.



The UX must be extremely simple and practical for a therapy-centre administrator.



---



2. CORE MODULES



Create the application architecture around these modules:



1. Authentication

2. Clinic Registration / Onboarding

3. Dashboard

4. Children

5. Child Profile

6. Therapists

7. Rooms / Cabins

8. Calendar / Appointments

9. Attendance

10. Packages

11. Payments

12. WhatsApp Centre

13. Notifications

14. Reports

15. Settings



The sidebar should logically group these into:



- Core

- Operations

- System



---



3. TECHNOLOGY FOUNDATION



Use a modern production-ready stack compatible with Lovable.



Frontend:



- React

- TypeScript

- Tailwind CSS

- Component-based architecture

- Responsive desktop/tablet/mobile UI



Backend:



- Supabase



Authentication:



- Supabase Auth

- Google OAuth

- Email/password authentication

- Persistent sessions

- Logout



Database:



- PostgreSQL through Supabase



Do NOT create a fake/mock backend.



All important operational records must be stored in Supabase.



---



4. MULTI-TENANT ARCHITECTURE



This is a critical requirement.



Every clinic must operate as an isolated tenant.



Create the appropriate clinic relationship so that each authenticated user belongs to an active clinic.



All clinic-owned data must be scoped using:



"clinic_id"



Clinic-owned entities include:



- children

- therapists

- rooms/cabins

- appointments

- attendance

- packages

- payments

- WhatsApp messages

- notifications

- reports/operational data



A user from Clinic A must NEVER be able to see or modify Clinic B data.



Do not rely only on frontend filtering.



Implement proper Supabase Row Level Security (RLS) policies.



Every tenant-owned table must have appropriate RLS protection for SELECT, INSERT, UPDATE and DELETE.



---



5. AUTHENTICATION FLOW



Unauthenticated users should only see:



- Login

- Register

- Google Sign-In



After successful authentication:



→ create/load the user's clinic context

→ enter Therapy Care

→ show the Dashboard



Session must persist after page refresh.



Logout must:

→ clear the session

→ return to authentication



Google OAuth must return the user to the Therapy Care application.



---



6. CLEAN INITIAL STATE — VERY IMPORTANT



A newly created clinic must start completely empty.



DO NOT create demo data.



DO NOT seed fake operational records.



Initial dashboard should show:



Today's appointments: 0

Collection: ₹0

Pending payments: 0

WhatsApp messages: 0

Children: 0

Therapists: 0



Appointments list should be empty.



Children list should be empty.



Therapists list should be empty.



Rooms/Cabins should be empty unless explicitly configured by the admin.



WhatsApp Centre must be empty.



Do NOT create fake children.



Do NOT create fake therapists.



Do NOT create fake appointments.



Do NOT create fake payments.



Do NOT create fake WhatsApp messages.



Do NOT hard-code dashboard numbers.



All dashboard numbers must come from the real Supabase database.



---



7. UI / UX DIRECTION



Create a premium but extremely simple administrative interface.



Priorities:



- Simple

- Fast

- Clear

- Professional

- Easy to operate

- Minimal unnecessary decoration

- Responsive

- Mobile-friendly

- Desktop-friendly

- Tablet-friendly



Do not create a complicated AI-style interface.



This is an operational clinic management system.



Use:



- clean cards

- clear tables

- practical forms

- obvious buttons

- meaningful empty states

- consistent spacing

- professional typography

- responsive layouts



The Dashboard should have compact operational metric cards and clear Quick Actions.



Do not redesign the concept into a completely different product.



---



8. CHILDREN MODULE



Admin must be able to:



- Add child

- Edit child

- View child profile

- Store parent/guardian information

- Store contact information

- Configure therapy track/specialty

- View appointment history

- View attendance

- View payment information where applicable



Every child must belong to the active "clinic_id".



Only children belonging to the active clinic may appear.



---



9. THERAPISTS MODULE



Admin must be able to:



- Add therapist

- Edit therapist

- View therapist

- Configure specialty

- Configure availability

- Enable/disable therapist where appropriate



Appointment booking must load therapists from the real database.



DO NOT hard-code therapist names.



If no therapist exists, show a clear message explaining that a therapist must first be configured.



---



10. ROOMS / CABINS



Create proper Room/Cabin management.



Admin must be able to:



- Add room/cabin

- Edit room/cabin

- Select room/cabin during appointment booking



DO NOT hard-code something such as:



"Speech Cabin 1"



The appointment form must load the actual rooms/cabins configured by the current clinic.



---



11. APPOINTMENTS



Create a complete appointment management system.



Appointment creation must support:



- Child

- Therapy Specialty

- Assigned Specialist

- Date

- Time Slot

- Room/Cabin

- Session Fee

- Status



All dropdowns must use real database records.



Appointment must be persisted to Supabase.



Session Fee must be a clean numeric input.



It must accept values such as:



500

1000

1500



Do NOT force unwanted leading zeros.



The field should be blank when creating a new appointment.



---



12. RECURRING APPOINTMENTS



Do NOT restrict recurrence to fixed presets such as only 4 weeks.



Allow:



- Start Date

- End Date

- Weekly recurrence



Example:



Start Date: 16 August

End Date: 16 November

Frequency: Weekly



Generate/persist the recurring appointments only within the selected range.



Prevent:



End Date < Start Date



Presets may exist only as optional shortcuts.



The actual start and end dates must remain fully configurable.



---



13. APPOINTMENT EDITING



Every appointment must be editable.



When editing an existing appointment, load:



- Child

- Specialty

- Therapist

- Room/Cabin

- Date

- Time

- Fee

- Status



The edit UI must remain fully usable.



Saving an edit must UPDATE the existing appointment.



Do NOT accidentally create a duplicate appointment.



Support:



- Edit

- Reschedule

- Cancel

- Status update



---



14. ATTENDANCE



Create attendance tracking linked to appointments/sessions.



Support appropriate statuses such as:



- Scheduled

- Completed

- Pending

- Cancelled



Attendance records must belong to the correct clinic.



---



15. PACKAGES



Create clinic-owned therapy package management.



Allow administrators to define and track therapy packages.



Packages must be associated with the correct clinic.



Do not create sample packages automatically.



---



16. PAYMENTS



Create payment management linked to:



- Child

- Appointment/session

- Package where applicable



Track:



- Paid

- Pending

- Payment amount

- Payment date

- Relevant payment information



Dashboard payment totals must be calculated from actual database records.



---



17. WHATSAPP CENTRE



WhatsApp Centre must be an operational communication system.



Initial state:



EMPTY



Do NOT create fake messages.



Do NOT create sample:



- Delivered

- Failed

- Session link sent

- Reminder sent



records automatically.



A WhatsApp record should only be created after a real user/API communication action.



All WhatsApp records must be scoped to the active clinic.



Any dashboard WhatsApp statistics must be calculated from real communication records/API results.



Never hard-code values such as:



98% success



---



18. DASHBOARD



Create a real database-driven dashboard.



Include useful operational metrics such as:



- Today's appointments

- Total appointments

- Completed

- Pending

- Cancelled

- Collection

- Pending payments

- Children

- Therapists

- WhatsApp activity



Also include:



- Ongoing & Upcoming appointments

- Quick Actions



When there is no data:



Show zero values and useful empty states.



Do NOT show fake/demo values.



---



19. SETTINGS



Create clinic administration settings.



Allow authorized admins to manage appropriate clinic configuration such as:



- Clinic profile

- Therapy specialties/types

- Therapists

- Rooms/Cabins

- Operational configuration

- User/account settings



Do not duplicate existing workflows unnecessarily.



---



20. DATABASE DESIGN



Create a clean relational Supabase schema around entities such as:



"clinics"



"profiles/users"



"children"



"therapists"



"rooms/cabins"



"appointments"



"attendance"



"packages"



"payments"



"whatsapp_messages"



"notifications"



Use proper foreign keys and relationships.



Every tenant-owned operational entity must have a valid clinic relationship.



---



21. DATA PERSISTENCE



This is mandatory.



The application must pass this flow:



Login

→ create real record

→ refresh

→ verify record

→ logout

→ login again

→ verify record again



Test persistence for:



- Child

- Therapist

- Room/Cabin

- Appointment

- Payment

- WhatsApp record created through a real action



Do not rely on localStorage as the primary database.



Supabase must be the source of truth.



---



22. DEVELOPMENT RULES



Before implementing features:



1. Establish the database architecture.

2. Establish authentication.

3. Establish clinic/tenant context.

4. Establish RLS.

5. Establish the application routing structure.

6. Establish the core UI shell.

7. Establish reusable components.

8. Then implement modules systematically.



Do not create duplicate tables or duplicate workflows when an existing implementation can be reused.



Do not introduce fake data to make the UI look populated.



Do not hard-code:



- dashboard metrics

- children

- therapists

- rooms

- appointments

- payments

- WhatsApp records



---



23. IMPORTANT PRODUCT RULE



This is the first implementation phase.



Do NOT try to hide unfinished functionality behind fake data.



Build the real architecture correctly first.



If a module is not yet fully implemented, create the correct structure and clearly mark the implementation state rather than pretending it works.



---



24. FIRST BUILD TARGET



For this first build, establish the complete Therapy Care foundation:



- Therapy Care branding

- Authentication UI

- Supabase integration structure

- Clinic onboarding

- Multi-tenant architecture

- Database schema

- RLS architecture

- Main responsive application shell

- Sidebar navigation

- Dashboard foundation

- Empty-state system

- Children module foundation

- Therapists module foundation

- Rooms/Cabins module foundation

- Appointments module foundation

- Settings foundation



The architecture must be designed so Attendance, Packages, Payments, WhatsApp Centre, Notifications and Reports can be implemented without restructuring the entire application later.



Do not use fake operational data.



Do not change the product name.



Do not use the old Therapy Centre OS branding.



The final product identity is:



Therapy Care



Build this as a serious production-ready therapy centre management platform, not as a prototype or static UI.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/32a14be0-58dc-4a1d-9800-5d0ecf12dd44).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
