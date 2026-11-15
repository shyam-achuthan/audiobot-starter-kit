# Run inside the chatwoot-web container by scripts/crm-setup.sh (rails runner).
# Creates (or reuses) the account, an admin user, an API inbox for voice tickets, an access token,
# and a webhook back to the AudioBots API. Prints one line: CW_RESULT={json}.
email   = ENV.fetch('CW_EMAIL')
pw      = ENV.fetch('CW_PASSWORD')
acct    = ENV.fetch('CW_ACCOUNT', 'AudioBots')
hook    = ENV['CW_WEBHOOK_URL'].to_s

account = Account.find_by(name: acct) || Account.create!(name: acct)

user = User.find_by(email: email)
created = false
unless user
  user = User.new(name: 'AudioBots Admin', email: email, password: pw, password_confirmation: pw)
  user.skip_confirmation!
  user.type = 'SuperAdmin'
  user.save!
  created = true
end
AccountUser.find_or_create_by!(account: account, user: user) { |au| au.role = :administrator }

inbox = account.inboxes.find_by(name: 'Voice calls')
unless inbox
  channel = Channel::Api.create!(account: account)
  inbox = account.inboxes.create!(name: 'Voice calls', channel: channel)
end
InboxMember.find_or_create_by!(inbox: inbox, user: user)

token = (user.access_token || AccessToken.create!(owner: user)).token

if hook.present?
  base = hook.split('?').first
  account.webhooks.where("url LIKE ?", "#{base}%").where.not(url: hook).destroy_all
  account.webhooks.find_or_create_by!(url: hook) do |w|
    w.subscriptions = %w[conversation_status_changed]
  end
end

puts 'CW_RESULT=' + { account_id: account.id, inbox_id: inbox.id, token: token, user_created: created }.to_json
