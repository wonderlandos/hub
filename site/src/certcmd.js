/* The command that asks for a certificate, for a person or an organisation. It must be exactly what `wol cert request`
   takes (controller cli.rs): GITHUB_ID LOGIN NAMESPACE NAME... [--org]. The namespace is the login in lower case and a
   dot, because that is what the Worker accepts (listings.ts namespaceOf; an upper-case letter is refused). The name is
   the person's display name (their login when GitHub has none) or, for an organisation, its login. A word the shell
   would treat as more than one is put in single quotes. Plain script; also loaded by the Node test. */
(function (root) {
  "use strict";
  var PLAIN = /^[\p{L}\p{N}._,@+:=%\/-]+$/u;
  function word(w) { return PLAIN.test(w) ? w : "'" + w.replace(/'/g, "'\\''") + "'"; }
  /* acct: { id, login, org }; me: the signed-in person ({ login, name }). */
  function command(acct, me) {
    var login = String(acct.login);
    var name = acct.org ? login : String((me && (me.name || me.login)) || login);
    var words = name.split(/\s+/).filter(Boolean);
    return ["wol", "cert", "request", String(acct.id), login, login.toLowerCase() + "."].concat(words.map(word)).join(" ") + (acct.org ? " --org" : "");
  }
  root.HubCert = { command: command };
})(typeof window !== "undefined" ? window : globalThis);
