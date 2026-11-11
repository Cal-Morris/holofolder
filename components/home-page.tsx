'use client';

import { Suspense, use, useState, type ReactNode } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { ArrowUpRight, BookOpen, Camera, Heart, Share2, Users, Wifi } from 'lucide-react';
import { CreditsNotice } from '@/components/credits';
import { MarketingCardFan } from '@/components/marketing-card-fan';
import { MarketingBinderPreview } from '@/components/marketing-binder-preview';
import { MarketingNavigation } from '@/components/marketing-navigation';
import { FEATURED_CARDS, getFeaturedCardImageSrcSet, getFeaturedCardImageUrl } from '@/lib/featured-cards';
import styles from '@/components/home-page.module.css';
import { useServiceWorkerRegistration } from '@/hooks/use-service-worker-registration';

// Client-only and loaded after hydration: keeps supabase-js and the sign-in form off the landing
// page's critical path. A tap before it arrives still opens it, because isOpen is already true.
const AuthModal = dynamic(() => import('@/components/auth-modal'), { ssr: false });

const features = [
  {
    id: 'collection-tracking',
    icon: BookOpen,
    title: 'Collection tracking.',
    text: 'Match each Pokémon to the card you own. Keep its set, language and finish with it, and mark the cards you want to upgrade.',
  },
  {
    id: 'scanning',
    icon: Camera,
    title: 'Card scanning.',
    text: 'Scan a card or a binder page, then check the matches. Switch between your binder, list, wanted cards and sets.',
  },
  {
    id: 'wishlisting',
    icon: Heart,
    title: 'Card wishlisting.',
    text: 'Save wanted cards and check card prices with their source evidence. No more trying to remember which version you meant.',
  },
  {
    id: 'sharing',
    icon: Share2,
    title: 'Share your collection.',
    text: 'Send a read-only link to your collection. They can look through the binder without changing your cards.',
  },
  {
    id: 'partners',
    icon: Users,
    title: 'Partner collections.',
    text: 'Invite a partner to update the same collection. Your changes stay in sync, so you both know what’s already in the binder.',
  },
  {
    id: 'offline',
    icon: Wifi,
    title: 'Offline access.',
    text: 'Install Holo Folder on your phone and keep your collection to hand. Offline edits sync when you’re connected again.',
  },
];

const SIGNED_OUT: Promise<boolean> = Promise.resolve(false);

function SignedInTextValue({ signedIn, yes, no }: { signedIn: Promise<boolean>; yes: ReactNode; no: ReactNode }) {
  return <>{use(signedIn) ? yes : no}</>;
}

/** Signed-out text in the static shell; swaps to the signed-in text once the session check streams in. */
function SignedInText(props: { signedIn: Promise<boolean>; yes: ReactNode; no: ReactNode }) {
  return (
    <Suspense fallback={props.no}>
      <SignedInTextValue {...props} />
    </Suspense>
  );
}

/**
 * The landing page. Everything except the signed-in labels is prerendered into the static shell:
 * `signedIn` is a promise the server starts (it reads cookies) and streams in after the shell.
 */
export default function HomePage({ signedIn = SIGNED_OUT }: { signedIn?: Promise<boolean> }) {
  useServiceWorkerRegistration();
  const router = useRouter();
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const openAuthOrApp = async () => {
    if (await signedIn) router.push('/');
    else setIsAuthOpen(true);
  };

  return (
    <>
      <main className={styles.home} id="top">
        <header className={styles.header}>
          <a href="#top" className={styles.brand}>
            <Image
              className={styles.brandMark}
              src="/app/holofolder-mark.png"
              alt=""
              width={24}
              height={24}
              unoptimized
            />
            Holo Folder
          </a>
          <MarketingNavigation />
          <button type="button" onClick={openAuthOrApp} className={styles.smallButton}>
            <SignedInText signedIn={signedIn} yes="Open app" no="Sign in" />
          </button>
        </header>

        <section className={styles.hero} aria-labelledby="hero-heading">
          <div className={styles.heroCopy}>
            <h1 id="hero-heading">
              Show us
              <br />
              your binder.
            </h1>
            <p className={styles.intro}>Keep track of your Pokémon cards, right down to the pocket.</p>
            <div className={styles.actions}>
              <button type="button" onClick={openAuthOrApp} className={styles.primaryButton}>
                <SignedInText signedIn={signedIn} yes="Open your binder" no="Start your collection" />
                <ArrowUpRight size={18} />
              </button>
              <Link href="/studio" className={styles.textLink}>
                Try the binder studio <ArrowUpRight size={16} />
              </Link>
            </div>
          </div>
          <MarketingCardFan />
        </section>

        <section id="collection" className={styles.collection} aria-labelledby="collection-heading">
          <div className={styles.sectionCopy}>
            <h2 id="collection-heading">
              Every pocket
              <br />
              has a story.
            </h2>
            <p>
              Start with your National Dex binder. Add the cards you own, keep a list of the ones you want, and leave
              room for a better find.
            </p>
            <button type="button" onClick={openAuthOrApp} className={styles.textLink}>
              Open your collection <ArrowUpRight size={16} />
            </button>
          </div>
          <div className={styles.sampleBinder}>
            <div className={styles.sampleHeading}>
              <span>Sample page</span>
            </div>
            <div className={styles.pocketGrid}>
              {FEATURED_CARDS.slice(0, 9).map((card) => (
                <div key={card.id} className={styles.pocket}>
                  <div className={`trading-card ${styles.cardFace}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={getFeaturedCardImageUrl(card)}
                      srcSet={getFeaturedCardImageSrcSet(card)}
                      sizes="(max-width: 650px) 30vw, 180px"
                      alt={`${card.name}, ${card.set}, ${card.num}`}
                      width={630}
                      height={880}
                      loading="lazy"
                      decoding="async"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="prices" className={styles.priceSection} aria-labelledby="prices-heading">
          <div className={styles.sectionCopy}>
            <h2 id="prices-heading">
              What’s that
              <br />
              card worth?
            </h2>
            <p>
              Check prices for the cards you own and the ones you’re after. See the market sources, price history and
              confidence behind each estimate.
            </p>
            <button type="button" onClick={openAuthOrApp} className={styles.textLink}>
              Check your collection <ArrowUpRight size={16} />
            </button>
          </div>
          <div className={styles.priceTools}>
            <article className={styles.priceTool}>
              <h3>Check the sources.</h3>
              <p>
                See where an estimate comes from and how much confidence to put in it. TCGplayer, Cardmarket and
                PokePulse provide market data where available.
              </p>
            </article>
            <article className={styles.priceTool}>
              <h3>See how prices move.</h3>
              <p>Look through saved price history. Rising and Breakout highlight moves backed by usable market data.</p>
            </article>
            <article className={styles.priceTool}>
              <h3>Keep an eye on wanted cards.</h3>
              <p>Keep the exact cards you want together, then compare prices when you’re deciding what to buy.</p>
            </article>
          </div>
        </section>

        <section id="features" className={styles.features} aria-labelledby="features-heading">
          <div className={styles.sectionHeading}>
            <h2 id="features-heading">
              Track, find,
              <br />
              and share.
            </h2>
          </div>
          <div className={styles.featureGrid}>
            {features.map(({ id, icon: Icon, title, text }) => (
              <article key={id} id={id}>
                <Icon size={22} strokeWidth={1.5} />
                <h3>{title}</h3>
                <p>{text}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="pricing" className={styles.accessSection} aria-labelledby="pricing-heading">
          <div className={styles.sectionCopy}>
            <h2 id="pricing-heading">
              Free while
              <br />
              we build it.
            </h2>
            <p>Holo Folder is free during early access.</p>
          </div>
          <article className={styles.accessPlan} aria-label="Early access pricing">
            <h3>Early access</h3>
            <p className={styles.priceAmount}>Free</p>
            <p className={styles.accessNote}>No subscription fee during early access.</p>
            <ul>
              <li>National Dex tracking and wanted lists</li>
              <li>Card prices, history and market signals</li>
              <li>Card and page scanning</li>
              <li>Partner collections and share links</li>
              <li>Offline collection access</li>
              <li>Binder Studio appearance designer</li>
            </ul>
            <button type="button" onClick={openAuthOrApp} className={styles.primaryButton}>
              <SignedInText signedIn={signedIn} yes="Open your collection" no="Start collecting" />
              <ArrowUpRight size={18} />
            </button>
          </article>
        </section>

        <section id="binder-studio" className={styles.studio} aria-labelledby="studio-heading">
          <div className={styles.studioCopy}>
            <h2 id="studio-heading">
              A binder with
              <br />
              your name on it.
            </h2>
            <p>
              Try colours, artwork and finishes in the 3D binder studio. Turn it around, open it up, and get the details
              how you like them.
            </p>
            <Link href="/studio" className={styles.primaryButton}>
              Enter the binder studio <ArrowUpRight size={18} />
            </Link>
          </div>
          <MarketingBinderPreview />
        </section>

        <footer className={styles.footer}>
          <div>
            <a href="#top" className={styles.brand}>
              Holo Folder
            </a>
          </div>
          <CreditsNotice className={styles.attribution} />
        </footer>
      </main>
      <AuthModal isOpen={isAuthOpen} onClose={() => setIsAuthOpen(false)} />
    </>
  );
}
