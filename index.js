// ============================================================
// Ticket Bot — Supabase Edition (config.js)
// Dengan button custom emoji & kategori "Order, Script, Help, Suggestion"
// ============================================================

const config = require('./config.js');
const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder,
        ButtonBuilder, ButtonStyle, PermissionsBitField, ChannelType,
        SlashCommandBuilder, REST, Routes, ModalBuilder,
        TextInputBuilder, TextInputStyle, StringSelectMenuBuilder,
        StringSelectMenuOptionBuilder, Partials } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');

const TOKEN = config.token;
const SUPABASE_URL = config.supabaseUrl;
const SUPABASE_KEY = config.supabaseKey;

if (!TOKEN || !SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Missing configuration in config.js');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.User, Partials.GuildMember]
});

// Emoji kustom
const SUCCESS_EMOJI = '<:verify:1543248750053425163>';
const TICKET_BUTTON_EMOJI = '<:byxiroz:1543248816940126288>';

// ============================================================
// Helper: fetch guild config from Supabase
// ============================================================
async function getGuildConfig(guildId) {
  const { data, error } = await supabase
    .from('ticket_config')
    .select('*')
    .eq('guild_id', guildId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function saveGuildConfig(guildId, configData) {
  const { error } = await supabase
    .from('ticket_config')
    .upsert({ guild_id: guildId, ...configData, updated_at: new Date().toISOString() })
    .eq('guild_id', guildId);
  if (error) throw error;
}

// ============================================================
// Helper: create/ensure Tickets category dengan nama khusus
// ============================================================
async function getOrCreateTicketsCategory(guild) {
  const CATEGORY_NAME = '- ᴛɪᴄᴋᴇᴛs'; // menggunakan karakter unik
  let cat = guild.channels.cache.find(
    c => c.type === ChannelType.GuildCategory && c.name === CATEGORY_NAME
  );
  if (!cat) {
    cat = await guild.channels.create({
      name: CATEGORY_NAME,
      type: ChannelType.GuildCategory,
      permissionOverwrites: [
        { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] }
      ]
    });
  }
  return cat;
}

// ============================================================
// Helper: send panel
// ============================================================
async function sendPanel(channel) {
  const configData = await getGuildConfig(channel.guild.id);
  if (!configData) return;

  const embed = new EmbedBuilder()
    .setColor('#ffffff')
    .setTitle('🎫 Ticket Support')
    .setDescription(
      '**Welcome!**\nClick the button below to open a ticket.\n\n' +
      '📌 Choose from: **Order**, **Script**, **Help**, **Suggestion**'
    )
    .setFooter({ text: configData.footer || 'Ticket System' })
    .setImage(configData.banner_url || null);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('open_ticket')
      .setLabel('Open Ticket')
      .setStyle(ButtonStyle.Primary)
      .setEmoji(TICKET_BUTTON_EMOJI) // emoji kustom
  );
  await channel.send({ embeds: [embed], components: [row] });
}

// ============================================================
// Helper: create ticket
// ============================================================
async function createTicket(interaction, category, label, subject, description) {
  const guild = interaction.guild;
  const user = interaction.user;

  // Check if user already has an open ticket in this category
  const { data: existing, error: existingError } = await supabase
    .from('tickets')
    .select('channel_id')
    .eq('guild_id', guild.id)
    .eq('user_id', user.id)
    .eq('category', category)
    .eq('status', 'open')
    .maybeSingle();

  if (existing) {
    const ch = guild.channels.cache.get(existing.channel_id);
    return interaction.reply({
      content: `⚠️ You already have an open ticket in this category: ${ch ? `<#${ch.id}>` : 'unknown'}`,
      ephemeral: true
    });
  }

  // Create channel
  const cat = await getOrCreateTicketsCategory(guild);
  const channelName = `ticket-${user.username.toLowerCase()}-${category}`;
  const channel = await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: cat.id,
    permissionOverwrites: [
      { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
      { id: user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.AttachFiles] },
      { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ManageChannels] }
    ]
  });

  // Insert ticket into database
  const { data: ticket, error: ticketError } = await supabase
    .from('tickets')
    .insert({
      guild_id: guild.id,
      channel_id: channel.id,
      user_id: user.id,
      category: category,
      subject: subject,
      description: description,
      status: 'open'
    })
    .select()
    .single();

  if (ticketError) {
    await channel.delete().catch(() => {});
    throw ticketError;
  }

  // Send welcome embed
  const embed = new EmbedBuilder()
    .setColor('#ffffff')
    .setTitle(`🎫 Ticket: ${label}`)
    .setDescription(
      `Hello ${user}, support will respond shortly.\n\n` +
      `**Category:** ${label}\n` +
      `**Subject:** ${subject || 'N/A'}\n` +
      `**Description:**\n${description || 'N/A'}\n\n` +
      `Created: <t:${Math.floor(Date.now() / 1000)}:F>`
    )
    .setFooter({ text: 'Click Close to end this ticket.' });

  const closeRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('close_ticket')
      .setLabel('🔒 Close Ticket')
      .setStyle(ButtonStyle.Danger)
  );

  await channel.send({ embeds: [embed], components: [closeRow] });

  // Log to log channel
  const configData = await getGuildConfig(guild.id);
  if (configData && configData.log_channel_id) {
    const logChannel = guild.channels.cache.get(configData.log_channel_id);
    if (logChannel) {
      const logEmbed = new EmbedBuilder()
        .setColor('#ffffff')
        .setTitle('📩 Ticket Opened')
        .addFields(
          { name: 'User', value: user.tag, inline: true },
          { name: 'Category', value: label, inline: true },
          { name: 'Channel', value: `<#${channel.id}>`, inline: true },
          { name: 'Subject', value: subject || 'N/A', inline: true }
        )
        .setTimestamp();
      await logChannel.send({ embeds: [logEmbed] });
    }
  }

  await interaction.reply({
    content: `${SUCCESS_EMOJI} Ticket created: <#${channel.id}>`,
    ephemeral: true
  });
}

// ============================================================
// Helper: close ticket
// ============================================================
async function closeTicket(interaction) {
  const channel = interaction.channel;
  const guild = interaction.guild;

  // Verify it's a ticket channel
  const { data: ticket, error: ticketError } = await supabase
    .from('tickets')
    .select('id')
    .eq('channel_id', channel.id)
    .eq('status', 'open')
    .maybeSingle();

  if (!ticket || ticketError) {
    return interaction.reply({ content: '❌ This is not a valid open ticket channel.', ephemeral: true });
  }

  // Permission check: user must have close role or be admin
  const configData = await getGuildConfig(guild.id);
  const hasCloseRole = configData?.close_roles?.some(rid => interaction.member.roles.cache.has(rid)) || false;
  const isAdmin = interaction.member.permissions.has(PermissionsBitField.Flags.Administrator);
  if (!hasCloseRole && !isAdmin) {
    return interaction.reply({ content: '❌ You do not have permission to close this ticket.', ephemeral: true });
  }

  await interaction.reply({ content: `🔒 Closing ticket... ${SUCCESS_EMOJI}` });

  // Fetch all messages from the channel
  const messages = await channel.messages.fetch({ limit: 100 });
  const messageLog = messages.reverse().map(m =>
    `[${m.createdAt.toISOString()}] ${m.author.tag}: ${m.content || '(attachment/embed)'}`
  ).join('\n');

  // Save final transcript
  const transcriptContent = `Ticket #${ticket.id} (${channel.name})\nClosed by ${interaction.user.tag}\n${'='.repeat(40)}\n\n${messageLog}`;
  const { data: transcript, error: transcriptError } = await supabase
    .from('transcripts')
    .insert({
      ticket_id: ticket.id,
      content: transcriptContent
    })
    .select()
    .single();

  if (transcriptError) {
    console.error('Failed to save transcript:', transcriptError);
    // Continue anyway
  }

  // Update ticket status
  await supabase
    .from('tickets')
    .update({ status: 'closed', closed_at: new Date().toISOString(), closed_by: interaction.user.id })
    .eq('id', ticket.id);

  // Send transcript to log channel
  if (configData && configData.log_channel_id) {
    const logChannel = guild.channels.cache.get(configData.log_channel_id);
    if (logChannel) {
      const logEmbed = new EmbedBuilder()
        .setColor('#ffffff')
        .setTitle('📄 Ticket Closed')
        .addFields(
          { name: 'Channel', value: `<#${channel.id}>`, inline: true },
          { name: 'Closed By', value: interaction.user.tag, inline: true },
          { name: 'Messages', value: `${messages.size}`, inline: true }
        )
        .setTimestamp();
      await logChannel.send({
        embeds: [logEmbed],
        files: [
          {
            attachment: Buffer.from(transcriptContent, 'utf-8'),
            name: `transcript_${channel.name}_${Date.now()}.txt`
          }
        ]
      });
    }
  }

  // Delete the channel after 5 seconds
  setTimeout(() => {
    channel.delete().catch(() => {});
  }, 5000);
}

// ============================================================
// Slash Commands
// ============================================================
const commands = [
  new SlashCommandBuilder()
    .setName('setup_ticket')
    .setDescription('Setup the ticket system (Admin only)')
    .addChannelOption(opt => opt.setName('panel_channel').setDescription('Channel where the panel will be sent').setRequired(true))
    .addChannelOption(opt => opt.setName('log_channel').setDescription('Channel for logs and transcripts').setRequired(true))
    .addStringOption(opt => opt.setName('close_roles').setDescription('Role IDs that can close tickets (comma separated)').setRequired(false))
    .addStringOption(opt => opt.setName('footer').setDescription('Footer text for the panel').setRequired(false))
    .addAttachmentOption(opt => opt.setName('banner').setDescription('Banner image (optional)').setRequired(false)),

  new SlashCommandBuilder()
    .setName('transcript')
    .setDescription('View transcripts of your closed tickets'),

  new SlashCommandBuilder()
    .setName('panel')
    .setDescription('Manually resend the ticket panel (Admin only)'),
];

// ============================================================
// Bot Ready
// ============================================================
client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  // Register slash commands globally
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log('✅ Slash commands registered');
  } catch (e) {
    console.error('Failed to register commands:', e);
  }
});

// ============================================================
// Interaction Handler
// ============================================================
client.on('interactionCreate', async (interaction) => {
  if (interaction.isCommand()) {
    const { commandName } = interaction;

    // ---- /setup_ticket ----
    if (commandName === 'setup_ticket') {
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        return interaction.reply({ content: '❌ You need Administrator permission.', ephemeral: true });
      }

      const panelChannel = interaction.options.getChannel('panel_channel');
      const logChannel = interaction.options.getChannel('log_channel');
      const closeRolesRaw = interaction.options.getString('close_roles');
      const footer = interaction.options.getString('footer') || 'Ticket System';
      const banner = interaction.options.getAttachment('banner');

      const closeRoles = closeRolesRaw ? closeRolesRaw.split(',').map(id => id.trim()).filter(Boolean) : [];

      await saveGuildConfig(interaction.guild.id, {
        panel_channel_id: panelChannel.id,
        log_channel_id: logChannel.id,
        close_roles: closeRoles,
        footer: footer,
        banner_url: banner ? banner.url : null,
        enabled: true
      });

      await interaction.reply({
        content: `${SUCCESS_EMOJI} Ticket system configured!\nPanel channel: <#${panelChannel.id}>\nLog channel: <#${logChannel.id}>`,
        ephemeral: true
      });

      await sendPanel(panelChannel);
      return;
    }

    // ---- /panel ----
    if (commandName === 'panel') {
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        return interaction.reply({ content: '❌ You need Administrator permission.', ephemeral: true });
      }
      const configData = await getGuildConfig(interaction.guild.id);
      if (!configData || !configData.panel_channel_id) {
        return interaction.reply({ content: '❌ Ticket system not set up. Use `/setup_ticket` first.', ephemeral: true });
      }
      const channel = interaction.guild.channels.cache.get(configData.panel_channel_id);
      if (!channel) return interaction.reply({ content: '❌ Panel channel not found.', ephemeral: true });
      await sendPanel(channel);
      await interaction.reply({ content: `${SUCCESS_EMOJI} Panel resent.`, ephemeral: true });
      return;
    }

    // ---- /transcript ----
    if (commandName === 'transcript') {
      const guildId = interaction.guild.id;
      const userId = interaction.user.id;
      const isAdmin = interaction.member.permissions.has(PermissionsBitField.Flags.Administrator);

      let query = supabase
        .from('tickets')
        .select('id, channel_id, category, subject, created_at, closed_at, user_id')
        .eq('guild_id', guildId)
        .eq('status', 'closed')
        .order('closed_at', { ascending: false });

      if (!isAdmin) {
        query = query.eq('user_id', userId);
      }

      const { data: tickets, error } = await query;

      if (error || !tickets || tickets.length === 0) {
        return interaction.reply({
          content: isAdmin ? '❌ No closed tickets found in this server.' : '❌ You have no closed tickets.',
          ephemeral: true
        });
      }

      const options = tickets.slice(0, 25).map(t => {
        const label = `${t.category} - ${t.subject || 'No subject'}`.slice(0, 100);
        return new StringSelectMenuOptionBuilder()
          .setLabel(label)
          .setValue(String(t.id))
          .setDescription(`Created: ${new Date(t.created_at).toLocaleDateString()}`);
      });

      const select = new StringSelectMenuBuilder()
        .setCustomId('select_transcript')
        .setPlaceholder('Select a ticket to view its transcript')
        .addOptions(options);

      const row = new ActionRowBuilder().addComponents(select);

      await interaction.reply({
        content: `📜 Select a closed ticket to view its transcript: ${SUCCESS_EMOJI}`,
        components: [row],
        ephemeral: true
      });
      return;
    }
  }

  // ---- Select Menu: select_transcript ----
  if (interaction.isStringSelectMenu() && interaction.customId === 'select_transcript') {
    await interaction.deferUpdate();

    const ticketId = parseInt(interaction.values[0], 10);
    if (isNaN(ticketId)) {
      return interaction.editReply({ content: '❌ Invalid ticket ID.', components: [] });
    }

    const { data: transcript, error } = await supabase
      .from('transcripts')
      .select('content')
      .eq('ticket_id', ticketId)
      .maybeSingle();

    if (error || !transcript) {
      return interaction.editReply({ content: '❌ Transcript not found for this ticket.', components: [] });
    }

    const buffer = Buffer.from(transcript.content, 'utf-8');
    const attachment = {
      attachment: buffer,
      name: `transcript_${ticketId}.txt`
    };

    await interaction.editReply({
      content: `${SUCCESS_EMOJI} Transcript for ticket #${ticketId}`,
      files: [attachment],
      components: []
    });
  }

  // ---- Button: open_ticket (dengan emoji kustom) ----
  if (interaction.isButton() && interaction.customId === 'open_ticket') {
    // Tampilkan select menu untuk memilih kategori: Order, Script, Help, Suggestion
    const menu = new StringSelectMenuBuilder()
      .setCustomId('category_select')
      .setPlaceholder('Select ticket type')
      .addOptions(
        new StringSelectMenuOptionBuilder()
          .setLabel('Order')
          .setDescription('Purchase, payment, or refund')
          .setValue('order')
          .setEmoji('🛒'),
        new StringSelectMenuOptionBuilder()
          .setLabel('Script')
          .setDescription('Script request or issue')
          .setValue('script')
          .setEmoji('📜'),
        new StringSelectMenuOptionBuilder()
          .setLabel('Help')
          .setDescription('General assistance')
          .setValue('help')
          .setEmoji('❓'),
        new StringSelectMenuOptionBuilder()
          .setLabel('Suggestion')
          .setDescription('Feedback or idea')
          .setValue('suggestion')
          .setEmoji('💡')
      );

    const row = new ActionRowBuilder().addComponents(menu);
    await interaction.reply({ content: 'Select a category:', components: [row], ephemeral: true });
  }

  // ---- Select Menu: category_select ----
  if (interaction.isStringSelectMenu() && interaction.customId === 'category_select') {
    const category = interaction.values[0];
    const labelMap = {
      order: 'Order',
      script: 'Script',
      help: 'Help',
      suggestion: 'Suggestion'
    };
    const label = labelMap[category] || category;

    // Tampilkan modal untuk subject & description
    const modal = new ModalBuilder()
      .setCustomId(`ticket_modal_${category}`)
      .setTitle(`New Ticket: ${label}`);

    const subjectInput = new TextInputBuilder()
      .setCustomId('subject')
      .setLabel('📌 Subject / Summary')
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const descInput = new TextInputBuilder()
      .setCustomId('description')
      .setLabel('📝 Description / Details')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true);

    modal.addComponents(
      new ActionRowBuilder().addComponents(subjectInput),
      new ActionRowBuilder().addComponents(descInput)
    );

    await interaction.showModal(modal);
  }

  // ---- Modal: ticket_modal_* ----
  if (interaction.isModalSubmit() && interaction.customId.startsWith('ticket_modal_')) {
    const category = interaction.customId.replace('ticket_modal_', '');
    const subject = interaction.fields.getTextInputValue('subject');
    const description = interaction.fields.getTextInputValue('description');
    const labelMap = {
      order: 'Order',
      script: 'Script',
      help: 'Help',
      suggestion: 'Suggestion'
    };
    const label = labelMap[category] || category;

    try {
      await createTicket(interaction, category, label, subject, description);
    } catch (err) {
      console.error('Ticket creation error:', err);
      await interaction.reply({ content: `❌ Failed to create ticket: ${err.message}`, ephemeral: true });
    }
  }

  // ---- Button: close_ticket ----
  if (interaction.isButton() && interaction.customId === 'close_ticket') {
    await closeTicket(interaction);
  }
});

// ============================================================
// Message Handler – store every message in transcript_messages
// ============================================================
client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;

  const { data: ticket, error } = await supabase
    .from('tickets')
    .select('id')
    .eq('channel_id', message.channel.id)
    .eq('status', 'open')
    .maybeSingle();

  if (!ticket) return;

  await supabase
    .from('transcript_messages')
    .insert({
      ticket_id: ticket.id,
      author: message.author.tag,
      content: message.content || '(attachment/embed)',
      timestamp: new Date().toISOString()
    })
    .catch(err => console.error('Failed to store message:', err));
});

// ============================================================
// Error handling
// ============================================================
process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
});

client.login(TOKEN);
