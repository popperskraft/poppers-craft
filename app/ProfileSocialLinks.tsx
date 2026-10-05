import { SOCIAL_LINK_FIELDS, otherSocialUrl, parseSocialLinks, socialProfileUrl } from "@/lib/social-links";
import { SocialPixelIcon } from "./SocialPixelIcon";

export function ProfileSocialLinks({ value }: { value: string }) {
  const socialLinks = parseSocialLinks(value);
  const visibleFields = SOCIAL_LINK_FIELDS.filter((field) => socialLinks[field.key]);
  const otherLinks = socialLinks.other.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);

  if (!visibleFields.length && !otherLinks.length) {
    return <p className="player-socials-empty">Контакты не заполнены.</p>;
  }

  return (
    <div className="player-social-icons">
      {visibleFields.map((field) => {
        const href = socialProfileUrl(field.key, socialLinks[field.key]);
        return href ? (
          <a className="player-social-icon" href={href} key={field.key} target="_blank" rel="noopener noreferrer" title={field.label} aria-label={field.label}><SocialPixelIcon name={field.icon} /></a>
        ) : null;
      })}
      {otherLinks.map((item, index) => {
        const href = otherSocialUrl(item);
        return href ? (
          <a className="player-social-icon" href={href} target="_blank" rel="noopener noreferrer" key={`${item}-${index}`} title={new URL(href).hostname} aria-label={new URL(href).hostname}><SocialPixelIcon name="other" /></a>
        ) : null;
      })}
    </div>
  );
}
