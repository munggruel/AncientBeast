import { Damage } from '../damage';
import { Team } from '../utility/team';
import * as matrices from '../utility/matrices';
import * as arrayUtils from '../utility/arrayUtils';
import { Creature } from '../creature';
import { Effect } from '../effect';
import { Direction } from '../utility/hex';

/** Creates the abilities
 * @param {Object} G the game object
 * @return {void}
 */
export default (G) => {
	G.abilities[39] = [
		/**
		 * First Ability: Larva Infest
		 * At both the beginning and end of the Headless turn, if there is an enemy
		 * creature in the hex directly at the back of the Headless, the enemy creature
		 * will instantly lose -5 maximum endurance.
		 *
		 * The upgraded ability also instantly applies the "fatigue" effect regardless
		 * of remaining endurance, as well as reducing -5 maximum endurance.
		 *
		 * If the Headless begins its turn in a position to trigger the ability, and
		 * ends its turn in the position, the enemy creature will have the ability effect
		 * applied twice.
		 */
		{
			trigger: 'onStartPhase onEndPhase',

			_targetTeam: Team.enemy,

			require: function () {
				// Headless only triggers ability on its own turn.
				if (this.creature !== this.game.activeCreature) {
					return false;
				}

				if (this.creature.materializationSickness) {
					return false;
				}

				if (
					!this.atLeastOneTarget(this._getHexes(), {
						team: this._targetTeam,
					})
				) {
					return false;
				}

				return this.testRequirements();
			},

			activate: function () {
				this.end();

				// require() has identified a valid target, so we can safely assume it is there.
				const target = this._getHexes()[0].creature;

				if (this.isUpgraded()) {
					// Upgraded ability causes fatigue - endurance set to 0.
					target.addFatigue(target.endurance);
				}

				const effect = new Effect(
					this.title,
					this.creature,
					target,
					// Effect never fades.
					'',
					{
						stackable: true,
						alterations: {
							endurance: -5,
						},
					},
					G,
				);

				target.addEffect(effect, `%CreatureName${target.id}% loses -5 endurance`);
				// Display potentially new "Fragile" status when losing maximum endurance.
				this.game.UI.updateFatigue();
			},

			_getHexes: function () {
				return this.creature.getHexMap(
					/* Headless position is the front hex of its two hexes, so we look for
					an enemy unit two hexes back which will be the hex directly behind Headless. */
					matrices.inlineback2hex,
				);
			},
		},

		// 	Second Ability: Cartilage Dagger
		{
			//	Type : Can be "onQuery", "onStartPhase", "onDamage"
			trigger: 'onQuery',

			_targetTeam: Team.enemy,

			// 	require() :
			require: function () {
				let crea = this.creature;

				if (!this.testRequirements()) {
					return false;
				}

				//At least one target
				if (
					!this.atLeastOneTarget(crea.getHexMap(matrices.frontnback2hex), {
						team: this._targetTeam,
					})
				) {
					return false;
				}
				return true;
			},

			// 	query() :
			query: function () {
				let ability = this;
				let crea = this.creature;

				G.grid.queryCreature({
					fnOnConfirm: function () {
						ability.animation(...arguments);
					},
					team: this._targetTeam,
					id: crea.id,
					flipped: crea.flipped,
					hexes: crea.getHexMap(matrices.frontnback2hex),
				});
			},

			//	activate() :
			activate: function (target) {
				let ability = this;
				ability.end();

				let d = {
					pierce: 11,
				};
				// Bonus for fatigued foe
				d.pierce = target.endurance <= 0 ? d.pierce * 2 : d.pierce;
				// Extra pierce damage if upgraded
				if (this.isUpgraded()) {
					let bonus = this.creature.stats.endurance - target.stats.endurance;
					if (bonus > 0) {
						d.pierce += bonus;
					}
				}

				let damage = new Damage(
					ability.creature, //Attacker
					d, // Damage Type
					1, // Area
					[], // Effects
					G,
				);

				target.takeDamage(damage);
			},
		},

		// 	Third Ability: Whip Move
		{
			//	Type : Can be "onQuery", "onStartPhase", "onDamage"
			trigger: 'onQuery',

			_targetTeam: Team.both,
			_directions: [0, 1, 0, 0, 1, 0],

			require: function () {
				const headless = this.creature;

				if (!this.testRequirements()) {
					return false;
				}

				// Headless must be moveable.
				if (!this.creature.stats.moveable) {
					this.message = G.msg.abilities.notMoveable;
					return false;
				}

				if (
					!this.testDirection({
						team: this._targetTeam,
						sourceCreature: headless,
						flipped: headless.player.flipped,
						directions: this._directions,
						distance: this._getMaxDistance(),
						minDistance: this.range.minimum,
						optTest: (creature) => creature.stats.moveable,
					})
				) {
					return false;
				}

				return true;
			},

			query: function () {
				const ability = this;
				const headless = this.creature;

				// TODO: Blue creature has 1 less range.

				G.grid.queryDirection({
					fnOnConfirm: function () {
						ability.animation(...arguments);
					},
					team: this._targetTeam,
					id: headless.id,
					requireCreature: true,
					stopOnCreature: true,
					sourceCreature: headless,
					flipped: headless.player.flipped,
					x: headless.x,
					y: headless.y,
					directions: this._directions,
					distance: this._getMaxDistance(),
					minDistance: this.range.minimum,
				});
			},

			activate: function (path, args) {
				const ability = this;
				const headless = this.creature;
				const target = arrayUtils.last(path).creature;

				this.game.grid.__debugHexes([...path]);

				// Remove creatures from path.
				path = path.filter((hex) => {
					return !hex.creature;
				});

				/* The query path starts away from Headless due to minimum range, so we
				first need to extend the path all the way back to in front of Headless. */
				const [firstHex, ...restOfPath] = path;
				const extendFunction =
					args.direction === Direction.Left ? arrayUtils.extendToRight : arrayUtils.extendToLeft;
				path = arrayUtils.sortByDirection(
					[...extendFunction([firstHex], this.range.minimum + 1, this.game.grid), ...restOfPath],
					args.direction === Direction.Left ? Direction.Right : Direction.Left,
				);

				ability.end();

				// Movement
				arrayUtils.filterCreature(path, false, false);
				let destination = null;
				let destinationTarget = null;
				if (target.size === 1) {
					/* Small creature, pull target towards self landing it in the hex directly
					in front of the Headless. */
					const hexInFrontOfHeadless = path[0];
					destinationTarget = hexInFrontOfHeadless;
					console.log(path, destinationTarget);
				} else if (target.size === 2) {
					// Medium creature, pull self and target towards each other half way,
					// rounding upwards for self (self move one extra hex if required)
					let midpoint = Math.floor((path.length - 1) / 2);
					destination = path[midpoint];
					if (midpoint < path.length - 1) {
						destinationTarget = path[midpoint + 1];
					}
				} else {
					// Large creature, pull self towards target
					destination = arrayUtils.last(path);
				}

				let x;
				let hex;

				// Check if Headless will be moved.
				if (destination) {
					x = args.direction === Direction.Left ? destination.x + headless.size - 1 : destination.x;
					hex = G.grid.hexes[destination.y][x];
					headless.moveTo(hex, {
						ignoreMovementPoint: true,
						ignorePath: true,
						callback: function () {
							let interval = setInterval(function () {
								if (!G.freezedInput) {
									clearInterval(interval);
									G.activeCreature.queryMove();
								}
							}, 100);
						},
					});
				}

				// Check if target creature will be moved.
				if (destinationTarget) {
					x =
						args.direction === Direction.Right
							? destinationTarget.x + target.size - 1
							: destinationTarget.x;
					hex = G.grid.hexes[destinationTarget.y][x];
					target.moveTo(hex, {
						ignoreMovementPoint: true,
						ignorePath: true,
						callback: function () {
							let interval = setInterval(function () {
								if (!G.freezedInput) {
									clearInterval(interval);
									G.activeCreature.queryMove();
								}
							}, 100);
						},
					});
				}
			},

			_getMaxDistance: function () {
				return this.isUpgraded() ? this.range.upgraded : this.range.regular;
			},
		},

		// 	Fourth Ability: Boomerang Tool
		{
			//	Type : Can be "onQuery","onStartPhase","onDamage"
			trigger: 'onQuery',

			damages: {
				slash: 10,
				crush: 5,
			},

			_getHexes: function () {
				// extra range if upgraded
				if (this.isUpgraded()) {
					return matrices.headlessBoomerangUpgraded;
				} else {
					return matrices.headlessBoomerang;
				}
			},

			// 	require() :
			require: function () {
				if (!this.testRequirements()) {
					return false;
				}
				return true;
			},

			// 	query() :
			query: function () {
				let ability = this;
				let crea = this.creature;

				let hexes = this._getHexes();

				G.grid.queryChoice({
					fnOnConfirm: function () {
						ability.animation(...arguments);
					},
					team: Team.both,
					requireCreature: 0,
					id: crea.id,
					flipped: crea.player.flipped,
					choices: [crea.getHexMap(hexes), crea.getHexMap(hexes, true)],
				});
			},

			activate: function (hexes) {
				let damages = {
					slash: 10,
				};

				let ability = this;
				ability.end();

				ability.areaDamage(
					ability.creature, //Attacker
					damages, //Damage Type
					[], //Effects
					ability.getTargets(hexes), //Targets
					true, //Notriggers avoid double retailiation
				);

				ability.areaDamage(
					ability.creature, //Attacker
					damages, //Damage Type
					[], //Effects
					ability.getTargets(hexes), //Targets
				);
			},
		},
	];
};
