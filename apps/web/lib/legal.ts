import type { Lang } from './copy';
import { CONTACT_EMAIL } from './links';

/**
 * Copy for /privacy and /support.
 *
 * Both locales, same as the rest of the site, so flipping `LANG` in copy.ts
 * carries the legal pages with it. The App Store listing links to /privacy —
 * Apple rejects a submission whose privacy URL 404s or is a placeholder.
 *
 * Everything claimed here is checked against the schema in supabase/migrations
 * and lib/push.ts. If the app starts storing something new, this file changes
 * in the same commit.
 */

export const LAST_UPDATED = { en: '31 July 2026', es: '31 de julio de 2026' };

export interface Section {
  heading: string;
  paras?: string[];
  bullets?: { term: string; detail: string }[];
}

interface LegalDoc {
  title: string;
  lede: string;
  updatedLabel: string;
  sections: Section[];
  backHome: string;
}

export const PRIVACY: Record<Lang, LegalDoc> = {
  en: {
    title: 'Privacy',
    updatedLabel: 'Last updated',
    lede: 'Planazo helps a group of friends decide whether something is happening. It keeps the least it can to do that. There is no advertising, no tracking, and nothing here is sold.',
    backHome: 'Back to planazo.me',
    sections: [
      {
        heading: 'What Planazo keeps',
        bullets: [
          {
            term: 'Your account',
            detail:
              'The email address you sign up with, and a password that is hashed by our authentication provider before it is stored. We never see the password itself.',
          },
          {
            term: 'Your profile',
            detail:
              'The display name you choose, the handle your invite links point at, and a profile photo if you add one.',
          },
          {
            term: 'Groups and plans',
            detail:
              'The groups you create or join, who else is in them, the plans posted to them, and your answers — whether you are in, whether you cannot make it, and which dates you marked as possible.',
          },
          {
            term: 'Notifications',
            detail:
              'A push token for each device where you turned notifications on, plus your notification and add-to-calendar preferences. Turning notifications off clears the token.',
          },
          {
            term: 'Feedback you send',
            detail:
              'The message you write, the app version and device model it came from, and a screenshot if you attach one. Only what you deliberately send.',
          },
        ],
      },
      {
        heading: 'What Planazo does not do',
        bullets: [
          {
            term: 'No advertising or tracking',
            detail:
              'No ad identifiers, no advertising networks, no third-party analytics or tracking SDKs. Nothing follows you to other apps or sites.',
          },
          {
            term: 'No selling or sharing',
            detail:
              'Your data is never sold, rented, or shared for anyone else’s marketing.',
          },
          {
            term: 'No location access',
            detail:
              'Planazo never reads your location. Where a plan is happening is free text somebody typed.',
          },
        ],
      },
      {
        heading: 'Camera and photos',
        paras: [
          'Planazo asks for your photo library only when you pick a profile photo or attach a screenshot to feedback, and for the camera only when you take a profile photo. It reads nothing in the background and nothing you did not choose.',
        ],
      },
      {
        heading: 'Who else handles it',
        paras: ['Planazo uses two processors, and no others.'],
        bullets: [
          {
            term: 'Supabase',
            detail:
              'Database, authentication and file storage, hosted in the United States. This is where your account, profile, groups, plans and answers live.',
          },
          {
            term: 'Expo and Apple push notification services',
            detail:
              'They deliver notifications to your device. They receive a device token and the text of the notification — for example that a plan you are in has reached its minimum.',
          },
        ],
      },
      {
        heading: 'Deleting your account',
        paras: [
          'You can delete your account from inside the app, under your profile. It is immediate and it is not reversible.',
          'Deleting removes your email address, display name, handle, profile photo, push tokens, preferences, every answer you gave, and any feedback you sent.',
          'Groups and plans other people are still using are not destroyed with you: a group you created passes to its longest-standing remaining member, and is deleted outright only if nobody else is left. Plans you posted stay in their group so the people who answered them keep their evening, but they stop carrying your name.',
        ],
      },
      {
        heading: 'How long it is kept',
        paras: [
          'For as long as your account exists. Delete the account and the data above goes with it, apart from anything our provider holds in encrypted backups, which roll off within 30 days.',
        ],
      },
      {
        heading: 'Your rights',
        paras: [
          'You can see and correct most of your data directly in the app. For a copy of everything held about you, or for anything the app cannot do itself, write to us and we will answer within 30 days.',
        ],
      },
      {
        heading: 'Children',
        paras: [
          'Planazo is not directed at children under 13, and we do not knowingly hold their data. If you believe a child has made an account, write to us and we will remove it.',
        ],
      },
      {
        heading: 'Changes',
        paras: [
          'If this policy changes in a way that affects what is collected or who handles it, the date at the top changes and the app tells you before it takes effect.',
        ],
      },
      {
        heading: 'Contact',
        paras: [`Questions, requests, or something that looks wrong: ${CONTACT_EMAIL}.`],
      },
    ],
  },
  es: {
    title: 'Privacidad',
    updatedLabel: 'Última actualización',
    lede: 'Planazo sirve para que un grupo de amigos decida si algo sale o no. Guarda lo mínimo para eso. No hay publicidad, no hay rastreo, y acá no se vende nada.',
    backHome: 'Volver a planazo.me',
    sections: [
      {
        heading: 'Qué guarda Planazo',
        bullets: [
          {
            term: 'Tu cuenta',
            detail:
              'El email con el que te registrás y una contraseña que nuestro proveedor de autenticación cifra antes de guardarla. Nosotros nunca vemos la contraseña.',
          },
          {
            term: 'Tu perfil',
            detail:
              'El nombre que elegís, el usuario al que apuntan tus links de invitación y una foto de perfil si la subís.',
          },
          {
            term: 'Grupos y planes',
            detail:
              'Los grupos que creás o a los que entrás, quiénes más están, los planes que se publican ahí y tus respuestas: si vas, si no podés, y qué días marcaste como posibles.',
          },
          {
            term: 'Notificaciones',
            detail:
              'Un token de envío por cada dispositivo donde activaste las notificaciones, y tus preferencias de aviso y de agenda. Si las desactivás, el token se borra.',
          },
          {
            term: 'El feedback que mandás',
            detail:
              'El mensaje que escribís, la versión de la app y el modelo del dispositivo, y una captura si la adjuntás. Solo lo que mandás a propósito.',
          },
        ],
      },
      {
        heading: 'Qué no hace Planazo',
        bullets: [
          {
            term: 'Nada de publicidad ni rastreo',
            detail:
              'Sin identificadores publicitarios, sin redes de anuncios, sin analíticas ni SDKs de terceros. Nada te sigue a otras apps ni a otros sitios.',
          },
          {
            term: 'No se vende ni se comparte',
            detail: 'Tus datos no se venden, ni se alquilan, ni se comparten para el marketing de nadie.',
          },
          {
            term: 'Sin acceso a tu ubicación',
            detail:
              'Planazo nunca lee tu ubicación. Dónde es un plan es un texto que alguien escribió.',
          },
        ],
      },
      {
        heading: 'Cámara y fotos',
        paras: [
          'Planazo pide tu galería solo cuando elegís una foto de perfil o adjuntás una captura al feedback, y la cámara solo cuando te sacás una foto de perfil. No lee nada de fondo ni nada que no hayas elegido.',
        ],
      },
      {
        heading: 'Quién más los procesa',
        paras: ['Planazo usa dos proveedores, y ninguno más.'],
        bullets: [
          {
            term: 'Supabase',
            detail:
              'Base de datos, autenticación y almacenamiento de archivos, alojados en Estados Unidos. Ahí viven tu cuenta, tu perfil, tus grupos, tus planes y tus respuestas.',
          },
          {
            term: 'Servicios de notificaciones de Expo y Apple',
            detail:
              'Entregan los avisos a tu teléfono. Reciben un token del dispositivo y el texto del aviso — por ejemplo, que un plan tuyo llegó al mínimo.',
          },
        ],
      },
      {
        heading: 'Borrar tu cuenta',
        paras: [
          'Podés borrar tu cuenta desde la app, en tu perfil. Es inmediato y no se puede deshacer.',
          'Al borrarla se van tu email, tu nombre, tu usuario, tu foto de perfil, los tokens de notificación, tus preferencias, todas tus respuestas y el feedback que hayas mandado.',
          'Los grupos y planes que otros siguen usando no se destruyen con vos: un grupo que creaste pasa al miembro más antiguo que quede, y se borra solo si no queda nadie. Los planes que publicaste siguen en su grupo, para que quienes contestaron no pierdan la noche, pero dejan de llevar tu nombre.',
        ],
      },
      {
        heading: 'Cuánto tiempo se guardan',
        paras: [
          'Mientras exista tu cuenta. Si la borrás, se van con ella, salvo lo que nuestro proveedor tenga en copias de seguridad cifradas, que se descartan en un plazo de 30 días.',
        ],
      },
      {
        heading: 'Tus derechos',
        paras: [
          'Podés ver y corregir casi todos tus datos desde la app. Para una copia de todo lo que tenemos sobre vos, o para algo que la app no pueda hacer sola, escribinos y respondemos dentro de 30 días.',
        ],
      },
      {
        heading: 'Menores',
        paras: [
          'Planazo no está dirigido a menores de 13 años y no guardamos sus datos a sabiendas. Si creés que un menor se hizo una cuenta, escribinos y la damos de baja.',
        ],
      },
      {
        heading: 'Cambios',
        paras: [
          'Si esta política cambia en algo que afecte qué se guarda o quién lo procesa, cambia la fecha de arriba y la app te avisa antes de que entre en vigor.',
        ],
      },
      {
        heading: 'Contacto',
        paras: [`Dudas, pedidos, o algo que se ve mal: ${CONTACT_EMAIL}.`],
      },
    ],
  },
};

export const SUPPORT: Record<Lang, LegalDoc> = {
  en: {
    title: 'Support',
    updatedLabel: 'Last updated',
    lede: 'Something broken, something confusing, or an idea for what Planazo should do next — all of it goes to the same place, and a person reads it.',
    backHome: 'Back to planazo.me',
    sections: [
      {
        heading: 'Write to us',
        paras: [
          `The fastest route is ${CONTACT_EMAIL}. Tell us what you were trying to do and what happened instead. We answer within two working days.`,
          'From inside the app you can also shake your phone or take a screenshot to send feedback with the version and device already attached — that saves a round of questions.',
        ],
      },
      {
        heading: 'Common things',
        bullets: [
          {
            term: 'I forgot my password',
            detail:
              'On the sign-in screen, tap “Forgot your password?” and we send a link to pick a new one. If it has not landed in a minute, check spam.',
          },
          {
            term: 'I am not getting notifications',
            detail:
              'Check Settings → Planazo → Notifications on your phone, then your notification preference in the app under your profile. Both have to be on.',
          },
          {
            term: 'An invite link will not open',
            detail:
              'Invite links only work once Planazo is installed. Install it, then tap the link again.',
          },
          {
            term: 'I want to leave a group',
            detail:
              'Open the group, then Manage. Leaving clears your answers to that group’s plans.',
          },
          {
            term: 'I want to delete my account',
            detail:
              'Profile → Delete account. It is immediate and cannot be undone. What happens to your groups and plans is set out in the privacy policy.',
          },
        ],
      },
      {
        heading: 'Reporting something serious',
        paras: [
          `For a security problem, a privacy request, or someone misusing the app, write to ${CONTACT_EMAIL} with “urgent” in the subject and we will look the same day.`,
        ],
      },
    ],
  },
  es: {
    title: 'Ayuda',
    updatedLabel: 'Última actualización',
    lede: 'Algo roto, algo confuso, o una idea de qué tendría que hacer Planazo después: todo va al mismo lugar y lo lee una persona.',
    backHome: 'Volver a planazo.me',
    sections: [
      {
        heading: 'Escribinos',
        paras: [
          `Lo más rápido es ${CONTACT_EMAIL}. Contanos qué estabas intentando hacer y qué pasó en su lugar. Respondemos dentro de dos días hábiles.`,
          'Desde la app también podés agitar el teléfono o sacar una captura para mandar feedback con la versión y el dispositivo ya adjuntos — eso ahorra una ronda de preguntas.',
        ],
      },
      {
        heading: 'Lo de siempre',
        bullets: [
          {
            term: 'Me olvidé la contraseña',
            detail:
              'En la pantalla de ingreso, tocá «¿Te olvidaste la contraseña?» y te mandamos un link para elegir una nueva. Si en un minuto no llegó, mirá el spam.',
          },
          {
            term: 'No me llegan las notificaciones',
            detail:
              'Fijate en Ajustes → Planazo → Notificaciones en el teléfono, y después tu preferencia dentro de la app, en tu perfil. Tienen que estar las dos.',
          },
          {
            term: 'No me abre un link de invitación',
            detail:
              'Los links de invitación funcionan una vez que Planazo está instalado. Instalalo y volvé a tocar el link.',
          },
          {
            term: 'Quiero salir de un grupo',
            detail:
              'Entrá al grupo y andá a Administrar. Al salir se borran tus respuestas a los planes de ese grupo.',
          },
          {
            term: 'Quiero borrar mi cuenta',
            detail:
              'Perfil → Borrar cuenta. Es inmediato y no se puede deshacer. Qué pasa con tus grupos y planes está en la política de privacidad.',
          },
        ],
      },
      {
        heading: 'Reportar algo serio',
        paras: [
          `Si es un problema de seguridad, un pedido de privacidad, o alguien usando mal la app, escribí a ${CONTACT_EMAIL} con «urgente» en el asunto y lo miramos el mismo día.`,
        ],
      },
    ],
  },
};
