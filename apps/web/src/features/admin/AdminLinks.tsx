import type { AdminLink } from '@coach/types';
import { Link } from '@tanstack/react-router';

/**
 * Relationship links of a record. A `records` link goes to the other record's page when the API names a model,
 * a `count` is a number and never a link, a `route` link goes to its `href` (the API never links to private
 * content such as questions or source text).
 */
export function AdminLinks({ links }: { links: AdminLink[] }) {
  if (links.length === 0) return null;
  return (
    <section aria-labelledby="admin-links-heading" className="flex flex-col gap-3">
      <h2 id="admin-links-heading" className="text-lg font-semibold">
        Related
      </h2>
      <dl className="flex flex-col gap-3">
        {links.map((link) => (
          <div key={link.name} className="flex flex-col gap-1">
            <dt className="text-sm font-medium">{link.label}</dt>
            <dd>
              {link.kind === 'count' && <span>{link.count}</span>}
              {link.kind === 'route' && (
                <Link
                  to={link.href as never}
                  className="font-medium text-primary underline underline-offset-4 hover:text-primary-hover"
                >
                  {link.label}
                </Link>
              )}
              {link.kind === 'records' && (
                <>
                  {link.items.length === 0 && <span className="text-muted-foreground">None</span>}
                  <ul className="flex flex-col gap-1">
                    {link.items.map((item) => (
                      <li key={item.id}>
                        {link.model ? (
                          <Link
                            to="/admin/$model/$id"
                            params={{ model: link.model, id: item.id }}
                            className="font-medium text-primary underline underline-offset-4 hover:text-primary-hover"
                          >
                            {item.title}
                          </Link>
                        ) : (
                          item.title
                        )}
                      </li>
                    ))}
                  </ul>
                  {link.truncated && <p className="text-sm text-muted-foreground">More exist.</p>}
                </>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
