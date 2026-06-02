const { DataTypes } = require('sequelize');
const { sequelize } = require('../index');

/**
 * UISettings — preferences UI par tenant.
 *
 * Stocke deux choses pour l'instant :
 *   - new_ui_enabled    : active le design moderne (rouge boucherie + sidebar)
 *   - sidebar_position  : 'left' ou 'right' (cote affichage de la sidebar)
 *
 * One row per tenant. Le champ `tenant` matche les cles de brand-config.json
 * (ex: 'MATA', 'SACRE_COEUR'). Defaut = 'MATA' si pas de tenant detectable.
 *
 * POS (pos.html) ignore ces settings et reste sur son layout dedie.
 */
const UISettings = sequelize.define('UISettings', {
    id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true
    },
    tenant: {
        type: DataTypes.STRING(64),
        allowNull: false,
        unique: true,
        defaultValue: 'MATA',
        comment: 'Cle tenant (matche brand-config.json)'
    },
    new_ui_enabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment: '[deprecated] toggle global. Garde pour back-compat — la verite est new_ui_roles.'
    },
    new_ui_roles: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: 'Liste JSON des roles pour lesquels le mode moderne est actif',
        get() {
            const raw = this.getDataValue('new_ui_roles');
            if (!raw) return [];
            try {
                return JSON.parse(raw);
            } catch (e) {
                // Log avec contexte pour debug ; on continue avec [] pour ne
                // pas casser le boot si la valeur DB est corrompue.
                console.error('[UISettings.new_ui_roles] JSON.parse failed:', {
                    raw: raw,
                    error: e.message
                });
                return [];
            }
        },
        set(value) {
            const arr = Array.isArray(value) ? value : [];
            this.setDataValue('new_ui_roles', JSON.stringify(arr));
        }
    },
    sidebar_position: {
        type: DataTypes.STRING(8),
        allowNull: false,
        defaultValue: 'right',
        validate: {
            isIn: {
                args: [['left', 'right']],
                msg: 'sidebar_position doit etre "left" ou "right"'
            }
        },
        comment: 'Position de la sidebar dans le design moderne : left | right'
    },
    default_theme: {
        type: DataTypes.STRING(8),
        allowNull: false,
        defaultValue: 'auto',
        validate: {
            isIn: {
                args: [['auto', 'light', 'dark']],
                msg: 'default_theme doit etre "auto", "light" ou "dark"'
            }
        },
        comment: 'Theme par defaut : auto (suit OS) | light | dark. User peut override via topbar.'
    },
    updated_by: {
        type: DataTypes.STRING(64),
        allowNull: true,
        comment: 'Username admin qui a fait le dernier changement'
    }
}, {
    tableName: 'ui_settings',
    timestamps: true,
    underscored: true
});

module.exports = UISettings;
